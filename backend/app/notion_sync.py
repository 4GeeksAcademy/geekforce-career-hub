"""Runs the Notion → Career Hub sync. Idempotent: matched by Notion page id, then by email."""
import logging
from datetime import datetime, time

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

from .config import settings
from .models import Application, Cohort, Student, SyncRun, User
from .rules import get_rules
from .services import notion as N
from .timeutil import UTC, local_today, tz

log = logging.getLogger("geekforce.sync")


def _cohort(db: DB, name: str, program: str) -> Cohort | None:
    if not name:
        return None
    c = db.scalar(select(Cohort).where(Cohort.external_id == name)) or \
        db.scalar(select(Cohort).where(Cohort.name == name))
    if not c:
        region = "latam" if program.upper().startswith("LATAM") else "spain" if program.upper().startswith("SPANISH") else "usa"
        c = Cohort(name=name, program=program or None, region=region, external_id=name)
        db.add(c)
        db.flush()
    elif program and not c.program:
        c.program = program
    return c


def _advisor(db: DB, name: str) -> User | None:
    if not name:
        return None
    return db.scalar(select(User).where(User.role.in_(["advisor", "admin"]), func.lower(User.name) == name.lower()))


def import_applications(db: DB, nc: N.NotionClient, st: Student, tracker_pages: list[str]) -> int:
    n = 0
    for page_id in tracker_pages:
        for db_id in nc.find_child_databases(page_id, "Job Application"):
            for ds in nc.database_sources(db_id):
                for row in nc.query_data_source(ds):
                    a = N.application_from_page(row)
                    if not a or db.scalar(select(Application.id).where(Application.external_id == a["external_id"])):
                        continue
                    applied_on = a.pop("applied_on")
                    app = Application(student_id=st.id, source="notion_import", **a)
                    if applied_on:
                        app.applied_at = datetime.combine(applied_on, time(12), tzinfo=tz()).astimezone(UTC)
                    db.add(app)
                    n += 1
    return n


def run_sync(db: DB, nc: N.NotionClient | None = None, triggered_by: str | None = None) -> dict:
    nc = nc or N.client()
    if not nc:
        return {"ok": False, "error": "Notion isn't connected (set NOTION_TOKEN)."}
    summary = {"created": 0, "updated": 0, "applications_imported": 0, "skipped": 0, "errors": []}
    r = get_rules(db)
    try:
        rows = list(nc.query_data_source(settings.notion_students_source_id,
                                         {"property": "GeekForce Status", "multi_select": {"contains": "Active"}}))
    except Exception as e:  # noqa: BLE001
        log.exception("Notion query failed")
        db.add(SyncRun(ok=False, summary={"error": str(e)}, triggered_by=triggered_by))
        db.commit()
        return {"ok": False, "error": f"Couldn't read the Student Tracker: {e}"}
    for row in rows:
        data = N.student_from_page(row)
        if not data:
            summary["skipped"] += 1
            continue
        try:
            st = db.scalar(select(Student).where(Student.notion_page_id == data["notion_page_id"]))
            user = st.user if st else db.scalar(select(User).where(func.lower(User.email) == data["email"]))
            if user and not st:
                st = user.student
            created = False
            if not user:
                user = User(email=data["email"], name=data["name"], role="student", password_hash=None)
                db.add(user)
                db.flush()
            if not st:
                st = Student(user_id=user.id, status="onboarding", career_points=r.starting_points,
                             guarantee_status="secured")
                db.add(st)
                created = True
            user.name = data["name"]
            st.notion_page_id = data["notion_page_id"]
            st.enrollment_plan = data["enrollment_plan"]
            if st.enrollment_plan != "job_guarantee" and st.guarantee_status != "suspended":
                st.guarantee_status = "not_eligible"
            elif st.guarantee_status == "not_eligible":
                st.guarantee_status = "secured" if st.status == "onboarding" else st.guarantee_status
            c = _cohort(db, data["cohort"], data["program"])
            if c:
                st.cohort_id = c.id
                if data["city"] and not c.location:
                    c.location = data["city"]
            adv = _advisor(db, data["advisor_name"])
            if adv:
                st.advisor_id = adv.id
            db.flush()
            # Notion moves the stage only when someone changed it there since the last sync; otherwise the
            # advisor's change in the hub stands.
            notion_stage = data["stage"]
            if notion_stage and notion_stage != st.notion_stage_seen:
                from .stages import set_stage
                set_stage(db, st, notion_stage, None, source="notion", notify=st.status == "active")
            st.notion_stage_seen = notion_stage
            st.notion_snapshot = data["snapshot"]
            st.payments_behind = N.payments_behind(data["snapshot"])
            st.notion_synced_at = datetime.now(UTC)
            st.country = st.country or "USA"
            if data["deadline_date"]:
                st.deadline_date = data["deadline_date"]
            if not st.job_search_start_date:
                st.job_search_start_date = data["start_date"] or local_today()
            if data.get("not_to_be_placed") and st.status in ("active", "onboarding"):
                st.status = "not_to_be_placed"
                st.status_reason = st.status_reason or "Marked “Not to be Placed” in Notion"
                st.status_changed_at = datetime.now(UTC)
            db.flush()
            if st.status == "onboarding" and data["tracker_pages"]:
                summary["applications_imported"] += import_applications(db, nc, st, data["tracker_pages"])
            summary["created" if created else "updated"] += 1
            db.commit()
        except Exception as e:  # noqa: BLE001 — one bad row must not stop the sync
            db.rollback()
            log.exception("sync failed for %s", data.get("email"))
            summary["errors"].append(f"{data.get('name')}: {e}")
    db.add(SyncRun(ok=not summary["errors"], summary=summary, triggered_by=triggered_by))
    db.commit()
    return {"ok": True, **summary}
