"""Admin endpoints: rules, users, cohorts, audit log, integration status, scheduled jobs."""
import secrets
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, EmailStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import hash_password, require_admin, require_staff
from ..config import settings
from ..db import get_db
from ..i18n import L
from ..jobs import JOBS, run_job
from ..models import AuditLog, Cohort, Notification, ResumeVersion, RuleSetting, Student, User
from ..rules import RULES, get_rules, rules_catalog
from ..timeutil import now_utc
from ..serializers import iso, student_brief

router = APIRouter(prefix="/admin", tags=["admin"])
cron_router = APIRouter(prefix="/cron", tags=["cron"])


@router.get("/rules")
def get_rule_list(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    return rules_catalog(db)


class RulesIn(BaseModel):
    values: dict[str, float]


@router.put("/rules")
def update_rules(body: RulesIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    current = get_rules(db)
    changes = []
    for k, v in body.values.items():
        if k not in RULES:
            raise HTTPException(422, f"Unknown rule: {k}")
        if current[k] == v:
            continue
        row = db.get(RuleSetting, k) or RuleSetting(key=k)
        row.value, row.updated_by = v, user.id
        db.add(row)
        changes.append(f"{RULES[k][1]}: {current[k]} → {v}")
    if changes:
        db.add(AuditLog(actor_id=user.id, action="rules_updated", detail="; ".join(changes)))
    db.commit()
    return rules_catalog(db)


@router.get("/audit")
def audit(limit: int = 100, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)).all()
    names = {u.id: u.name for u in db.scalars(select(User))}
    students = {s.id: names.get(s.user_id) for s in db.scalars(select(Student))}
    return [{"id": a.id, "created_at": iso(a.created_at), "actor": names.get(a.actor_id, "System"),
             "student": students.get(a.student_id), "action": a.action, "detail": a.detail} for a in rows]


@router.get("/integrations")
def integrations(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    month_start = date.today().replace(day=1)
    emails = db.scalar(select(func.count(Notification.id)).where(
        Notification.email_sent.is_(True), Notification.created_at >= month_start)) or 0
    analyses = db.scalar(select(func.count(ResumeVersion.id)).where(ResumeVersion.created_at >= month_start)) or 0
    from ..models import Job, SyncRun
    ac_on = bool(settings.ac_url and settings.ac_key)
    jobs_week = db.scalar(select(func.count(Job.id)).where(Job.created_at >= date.today() - timedelta(days=7))) or 0
    last_sync = db.scalar(select(SyncRun).order_by(SyncRun.created_at.desc()))
    return [
        {"key": "activecampaign", "name": "ActiveCampaign", "connected": ac_on,
         "detail": f"{emails} alert emails this month · automation on tag “GF Alert”" if ac_on
                   else "Add ACTIVECAMPAIGN_URL and ACTIVECAMPAIGN_API_KEY to send emails"},
        {"key": "notion", "name": "Notion", "connected": bool(settings.notion_token),
         "detail": (f"Last sync {last_sync.created_at:%b %-d, %-I:%M %p} UTC" if last_sync else "Syncs nightly at 12:30 AM")
                   if settings.notion_token else "Add NOTION_TOKEN to sync the Student Tracker"},
        {"key": "adzuna", "name": "Adzuna (Job Radar)", "connected": bool(settings.adzuna_app_id and settings.adzuna_app_key),
         "detail": f"{jobs_week} jobs found in the last 7 days · daily at 10:00 AM ET"},
        {"key": "grokbot", "name": "grokbot inbox", "connected": bool(settings.jobs_ingest_secret),
         "detail": "POST /api/v1/integrations/jobs with header X-Jobs-Secret" if settings.jobs_ingest_secret
                   else "Add JOBS_INGEST_SECRET to receive jobs from grokbot"},
        {"key": "claude", "name": "Claude API", "connected": bool(settings.anthropic_api_key),
         "detail": f"{analyses} resume analyses this month" if settings.anthropic_api_key else "Add ANTHROPIC_API_KEY for the resume builder"},
        {"key": "extension", "name": "Chrome extension", "connected": True,
         "detail": "Logs applications from LinkedIn, Indeed, Glassdoor and Greenhouse"},
        {"key": "breathcode", "name": "Breathcode", "connected": settings.breathcode_enabled,
         "detail": "4Geeks login and attendance sync" if settings.breathcode_enabled else
                   "Phase 2. Until then advisors mark attendance here."},
    ]


@router.post("/integrations/activecampaign/setup")
def ac_setup(user: User = Depends(require_admin)):
    """Create the GeekForce custom fields and tags in ActiveCampaign so the team can build the automations."""
    from ..services import activecampaign as ac
    if not ac.configured():
        raise HTTPException(400, "ActiveCampaign isn't connected")
    try:
        client = ac.AC()
        fields = client.field_ids()
        tags = [client.tag_id(t) and t for t in [ac.ALERT_TAG, ac.INVITE_TAG, *ac.STATUS_TAGS.values(), *ac.STAGE_TAGS.values()]]
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"ActiveCampaign said: {e}")
    return {"ok": True, "fields": sorted(fields), "tags": tags}


# ── users & cohorts ──

class UserIn(BaseModel):
    email: EmailStr
    name: str
    role: str = "student"
    password: str | None = None
    cohort_id: str | None = None
    advisor_id: str | None = None
    country: str | None = None
    job_search_start_date: date | None = None
    deadline_days: int | None = None


class UserPatch(BaseModel):
    name: str | None = None
    email: str | None = None
    role: str | None = None
    is_active: bool | None = None
    cohort_id: str | None = None
    advisor_id: str | None = None
    job_search_start_date: date | None = None
    deadline_days: int | None = None
    password: str | None = None


def user_dict(u: User, history: dict | None = None) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "is_active": u.is_active,
            "archived_at": iso(u.archived_at), "language": u.language,
            "last_login_at": iso(u.last_login_at), "student": student_brief(u.student) if u.student else None,
            "job_search_start_date": u.student.job_search_start_date.isoformat()
            if u.student and u.student.job_search_start_date else None,
            **({"history": history} if history is not None else {})}


def _history(db: Session, u: User) -> dict:
    """What would be lost by deleting this person for good."""
    from ..models import Application, Interaction, PointsEvent, Session as SessionModel
    h = {"students_advised": db.scalar(select(func.count(Student.id)).where(Student.advisor_id == u.id)) or 0,
         "sessions_led": db.scalar(select(func.count(SessionModel.id)).where(SessionModel.advisor_id == u.id)) or 0,
         "notes_written": db.scalar(select(func.count(Interaction.id)).where(Interaction.advisor_id == u.id)) or 0,
         "audit_entries": db.scalar(select(func.count(AuditLog.id)).where(AuditLog.actor_id == u.id)) or 0}
    if u.student:
        sid = u.student.id
        h.update({"points_events": db.scalar(select(func.count(PointsEvent.id)).where(PointsEvent.student_id == sid)) or 0,
                  "applications": db.scalar(select(func.count(Application.id)).where(Application.student_id == sid)) or 0,
                  "sessions": db.scalar(select(func.count(SessionModel.id)).where(SessionModel.student_id == sid)) or 0})
    return h


@router.get("/users")
def list_users(role: str | None = None, archived: bool = False, user: User = Depends(require_staff),
               db: Session = Depends(get_db)):
    q = select(User).order_by(User.name)
    q = q.where(User.archived_at.is_not(None)) if archived else q.where(User.archived_at.is_(None))
    if role:
        q = q.where(User.role.in_(role.split(",")))
    return [user_dict(u) for u in db.scalars(q)]


@router.get("/users/{uid}")
def get_user(uid: str, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "Not found")
    return user_dict(u, _history(db, u))


@router.post("/users", status_code=201)
def create_user(body: UserIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    if body.role not in ("student", "advisor", "admin"):
        raise HTTPException(422, "Unknown role")
    if db.scalar(select(User).where(func.lower(User.email) == body.email.lower())):
        raise HTTPException(409, "A user with this email already exists")
    temp = body.password or secrets.token_urlsafe(9)
    u = User(email=body.email.lower(), name=body.name, role=body.role, password_hash=hash_password(temp))
    db.add(u)
    db.flush()
    if body.role == "student":
        r = get_rules(db)
        st = Student(user_id=u.id, cohort_id=body.cohort_id, advisor_id=body.advisor_id, country=body.country,
                     career_points=r.starting_points, guarantee_status="secured",
                     job_search_start_date=body.job_search_start_date or date.today(),
                     deadline_days=body.deadline_days)
        db.add(st)
    db.add(AuditLog(actor_id=user.id, action="user_created", detail=f"{body.name} ({body.role})"))
    db.commit()
    return {**user_dict(u), "temporary_password": None if body.password else temp}


def _admins_left(db: Session, excluding: str) -> int:
    return db.scalar(select(func.count(User.id)).where(User.role == "admin", User.is_active.is_(True),
                                                       User.archived_at.is_(None), User.id != excluding)) or 0


@router.patch("/users/{uid}")
def update_user(uid: str, body: UserPatch, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "Not found")
    data = body.model_dump(exclude_unset=True)
    changes = []
    if "email" in data and data["email"] and data["email"].lower() != u.email:
        email = data["email"].strip().lower()
        if "@" not in email:
            raise HTTPException(422, "Enter a valid email")
        if db.scalar(select(User).where(func.lower(User.email) == email, User.id != u.id)):
            raise HTTPException(409, "A user with this email already exists")
        changes.append(f"email {u.email} → {email}")
        u.email = email
    if "name" in data and data["name"] and data["name"].strip() != u.name:
        changes.append(f"name {u.name} → {data['name'].strip()}")
        u.name = data["name"].strip()
    if "role" in data and data["role"] and data["role"] != u.role:
        new = data["role"]
        if new not in ("student", "advisor", "admin"):
            raise HTTPException(422, "Unknown role")
        if (new == "student") != (u.role == "student"):
            raise HTTPException(422, "Students and staff have different records. To move someone between them, "
                                     "remove this account and create a new one with the other role.")
        if u.role == "admin" and _admins_left(db, u.id) == 0:
            raise HTTPException(422, "This is the last admin. Make someone else admin first.")
        changes.append(f"role {u.role} → {new}")
        u.role = new
    if "is_active" in data and data["is_active"] is not None and data["is_active"] != u.is_active:
        if not data["is_active"] and u.id == user.id:
            raise HTTPException(422, "You can't deactivate your own account.")
        if not data["is_active"] and u.role == "admin" and _admins_left(db, u.id) == 0:
            raise HTTPException(422, "This is the last admin. Make someone else admin first.")
        changes.append("activated" if data["is_active"] else "deactivated")
        u.is_active = data["is_active"]
    if "password" in data and data["password"]:
        if len(data["password"]) < 8:
            raise HTTPException(422, "Use at least 8 characters")
        u.password_hash = hash_password(data["password"])
        changes.append("password reset")
    if u.student:
        for k in ("cohort_id", "advisor_id", "job_search_start_date", "deadline_days"):
            if k in data and getattr(u.student, k) != data[k]:
                setattr(u.student, k, data[k] or None)
                changes.append(k.replace("_id", "").replace("_", " ") + " changed")
    if changes:
        db.add(AuditLog(actor_id=user.id, student_id=u.student.id if u.student else None, action="user_updated",
                        detail=f"{u.name}: " + "; ".join(changes)))
    db.commit()
    return user_dict(u)


class RemoveIn(BaseModel):
    permanent: bool = False
    reassign_to: str | None = None  # advisor's students go to this advisor
    reason: str | None = Field(default=None, max_length=500)


@router.post("/users/{uid}/remove")
def remove_user(uid: str, body: RemoveIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Remove someone from the lists. By default the account is archived (can't sign in, history kept, restorable).
    permanent=true deletes it, only when there is no history attached."""
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "Not found")
    if u.id == user.id:
        raise HTTPException(422, "You can't remove your own account.")
    if u.role == "admin" and _admins_left(db, u.id) == 0:
        raise HTTPException(422, "This is the last admin. Make someone else admin first.")
    advised = list(db.scalars(select(Student).where(Student.advisor_id == u.id)).all())
    if advised:
        to = db.get(User, body.reassign_to) if body.reassign_to else None
        if not to or to.role not in ("advisor", "admin") or to.id == u.id or to.archived_at:
            raise HTTPException(422, L("{name} advises {n} student(s). Choose who takes them over.", name=u.name, n=len(advised)))
        for st in advised:
            st.advisor_id = to.id
    name = u.name
    if body.permanent:
        h = _history(db, u)
        h.pop("students_advised", None)
        if any(h.values()):
            raise HTTPException(422, "This person has history (points, applications, sessions or notes), so they can "
                                     "only be archived. Archiving keeps the records and blocks sign-in.")
        from sqlalchemy import delete as sa_delete
        from sqlalchemy.exc import IntegrityError
        from ..models import NotificationPreference
        try:
            with db.begin_nested():
                db.execute(sa_delete(Notification).where(Notification.user_id == u.id))
                db.execute(sa_delete(NotificationPreference).where(NotificationPreference.user_id == u.id))
                if u.student:
                    db.delete(u.student)
                    db.flush()
                db.delete(u)
                db.flush()
        except IntegrityError:
            raise HTTPException(422, "This person still has records linked to them, so they can only be archived. "
                                     "Archiving keeps the records and blocks sign-in.")
        db.add(AuditLog(actor_id=user.id, action="user_deleted", detail=f"{name}" + (f" · {body.reason}" if body.reason else "")))
        db.commit()
        return {"ok": True, "deleted": True}
    u.is_active, u.archived_at = False, now_utc()
    if u.student and u.student.status in ("active", "onboarding"):
        u.student.status = "withdrawn"
    db.add(AuditLog(actor_id=user.id, student_id=u.student.id if u.student else None, action="user_archived",
                    detail=f"{name}" + (f" · reassigned {len(advised)} student(s)" if advised else "") +
                           (f" · {body.reason}" if body.reason else "")))
    db.commit()
    return {"ok": True, "archived": True, "reassigned": len(advised)}


@router.post("/users/{uid}/restore")
def restore_user(uid: str, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u or not u.archived_at:
        raise HTTPException(404, "Not found")
    u.archived_at, u.is_active = None, True
    if u.student and u.student.status == "withdrawn":
        u.student.status = "active"
    db.add(AuditLog(actor_id=user.id, action="user_restored", detail=u.name))
    db.commit()
    return user_dict(u)


class CohortIn(BaseModel):
    name: str
    program: str | None = None
    location: str | None = None
    region: str = "usa"
    deadline_days: int | None = None


@router.get("/cohorts")
def list_cohorts(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    return [{"id": c.id, "name": c.name, "program": c.program, "location": c.location, "region": c.region,
             "deadline_days": c.deadline_days} for c in db.scalars(select(Cohort).order_by(Cohort.name))]


@router.post("/cohorts", status_code=201)
def create_cohort(body: CohortIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    c = Cohort(**body.model_dump())
    db.add(c)
    db.commit()
    return {"id": c.id, **body.model_dump()}


# ── scheduled jobs (manual trigger for admins, or external cron with the secret) ──

@router.post("/jobs/{name}")
def admin_run_job(name: str, user: User = Depends(require_admin)):
    if name not in JOBS:
        raise HTTPException(404, "Unknown job")
    return run_job(name)


@cron_router.post("/{name}")
def cron_run_job(name: str, x_cron_secret: str = Header("")):
    if not settings.cron_secret or not secrets.compare_digest(x_cron_secret, settings.cron_secret):
        raise HTTPException(401, "Bad cron secret")
    if name not in JOBS:
        raise HTTPException(404, "Unknown job")
    return run_job(name)


class ReinstateIn(BaseModel):
    reason: str
    set_points: int | None = None


@router.post("/students/{student_id}/reinstate")
def reinstate(student_id: str, body: ReinstateIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    from .. import engine
    st = db.get(Student, student_id)
    if not st:
        raise HTTPException(404, "Student not found")
    engine.reinstate_guarantee(db, st, user, body.reason, body.set_points)
    db.commit()
    return student_brief(st)
