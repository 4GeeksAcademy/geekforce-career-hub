"""Rules settled Oct 6, 2026: permanent suspension, admin reinstatement, rejected entries, plan targets,
stage gating, Not Started ladder, onboarding/activation, interactions and the Notion sync."""
from datetime import timedelta

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app import engine
from app.jobs import daily, weekly_check
from app.models import Application, PointsEvent, Session, Student, User
from app.notion_sync import run_sync
from app.services.notion import NotionClient, application_from_page, map_stage, student_from_page
from app.timeutil import local_today, now_utc
from tests.conftest import auth


def test_suspension_is_permanent_and_admin_can_reinstate(db, people):
    st, adv, adm = people["student"], people["advisor"], people["admin"]
    st.career_points, st.guarantee_status = 65, "at_risk"
    db.commit()
    engine.manual_adjustment(db, st, adv, -10, "Test drop below 60")
    assert st.guarantee_status == "suspended" and st.suspended_at
    engine.manual_adjustment(db, st, adv, 40, "Lots of good work afterwards")
    assert st.career_points == 95 and st.guarantee_status == "suspended"  # never restores by itself
    with pytest.raises(HTTPException):
        engine.reinstate_guarantee(db, st, adm, "short")
    engine.reinstate_guarantee(db, st, adm, "Deduction was logged against the wrong student")
    assert st.guarantee_status == "secured" and st.suspended_at is None


def test_reinstate_requires_balance_above_60(db, people):
    st, adm = people["student"], people["admin"]
    st.career_points, st.guarantee_status = 40, "suspended"
    db.commit()
    with pytest.raises(HTTPException):
        engine.reinstate_guarantee(db, st, adm, "Appeal approved by the GeekForce team")
    engine.reinstate_guarantee(db, st, adm, "Appeal approved by the GeekForce team", set_points=70)
    assert st.career_points == 70 and st.guarantee_status == "at_risk"


def test_rejected_entry_removes_points_and_frees_cap(db, people):
    st, u, adv = people["student"], people["student_user"], people["advisor"]
    acts = [engine.log_activity(db, st, kind="outreach", user=u, occurred_on=local_today(), contact_name="A", company="B")
            for _ in range(5)]
    db.commit()
    assert st.career_points == 100
    engine.reject_activity(db, acts[0], adv, "No proof of this message")
    db.commit()
    assert st.career_points == 95
    assert engine.activities_in_week(db, st.id, "outreach", engine.week_start(), True) == 4
    engine.log_activity(db, st, kind="outreach", user=u, occurred_on=local_today(), contact_name="C", company="D")
    assert st.career_points == 100  # the freed slot earns again


def _apps_last_week(db, st, n):
    today = local_today()
    monday = today - timedelta(days=today.weekday())
    days_ago = (today - (monday - timedelta(days=4))).days
    for i in range(n):
        db.add(Application(student_id=st.id, company=f"C{i}", role="Dev", applied_at=now_utc() - timedelta(days=days_ago)))
    db.commit()
    return monday


def test_professional_support_target_is_10(db, people):
    st = people["student"]
    st.enrollment_plan, st.guarantee_status = "professional_support", "not_eligible"
    monday = _apps_last_week(db, st, 10)
    weekly_check(db, today=monday)
    assert st.career_points == 90  # bonus, 10 meets the Professional Support target


def test_quota_only_from_stage_3(db, people):
    st = people["student"]
    st.stage = "interview_prep"
    monday = _apps_last_week(db, st, 0)
    weekly_check(db, today=monday)
    assert st.career_points == 80
    st.stage = "job_hunting"
    db.commit()
    weekly_check(db, today=monday)
    assert st.career_points == 70


def test_not_started_ladder(db, people):
    st = people["student"]
    st.activated_at = now_utc() - timedelta(days=7)
    st.job_search_start_date = local_today() - timedelta(days=7)
    st.last_activity_at = now_utc()
    db.commit()
    daily(db)
    assert st.not_started_level == 7 and not st.on_hold
    st.activated_at = now_utc() - timedelta(days=15)
    db.commit()
    daily(db)
    assert st.on_hold and engine.is_paused(st)
    # on hold: automatic deductions are frozen
    engine.award(db, st, "deduction_weekly", -10, "test")
    assert st.career_points == 80
    st.activated_at = now_utc() - timedelta(days=30)
    db.commit()
    daily(db)
    assert st.guarantee_status == "suspended"


def test_first_one_on_one_clears_hold(db, people):
    st, adv = people["student"], people["advisor"]
    st.on_hold, st.not_started_level = True, 15
    db.commit()
    engine.log_session(db, st, adv, session_type="one_on_one", attendance="attended", session_date=now_utc(),
                       title=None, summary=None, resources=[], new_homework=[], completed_task_ids=set())
    assert not st.on_hold and st.not_started_level == 0


def test_login_does_not_reset_inactivity(client, db, people):
    st = people["student"]
    st.job_search_start_date = local_today() - timedelta(days=100)
    st.last_activity_at = now_utc() - timedelta(days=31)
    db.commit()
    client.post("/api/v1/auth/login", json={"email": "stu@test.io", "password": "secret123"})
    db.expire_all()
    daily(db)
    assert db.scalar(select(PointsEvent).where(PointsEvent.event_type == "deduction_inactivity")) is not None


def test_interactions_private_vs_shared(client, people):
    sid = people["student"].id
    h = auth(people["advisor"])
    for vis in ("private", "shared"):
        r = client.post("/api/v1/advisor/interactions", headers=h, json={
            "student_id": sid, "occurred_at": "2026-10-06T15:00:00Z", "channel": "slack",
            "summary": f"{vis} note about the offer", "visibility": vis, "follow_up_date": "2026-10-01"})
        assert r.status_code == 201, r.text
    assert len(client.get(f"/api/v1/students/{sid}/interactions", headers=h).json()) == 2
    mine = client.get("/api/v1/students/me/interactions", headers=auth(people["student_user"])).json()
    assert [m["summary"] for m in mine] == ["shared note about the offer"]
    att = client.get("/api/v1/advisor/attention", headers=h).json()
    assert sum(1 for a in att if a["kind"] == "follow_up") == 2


# ── Notion ──

def _title(t): return {"type": "title", "title": [{"plain_text": t}]}
def _rt(t): return {"type": "rich_text", "rich_text": [{"plain_text": t}]}
def _sel(t): return {"type": "select", "select": {"name": t} if t else None}
def _ms(*t): return {"type": "multi_select", "multi_select": [{"name": x} for x in t]}
def _date(d): return {"type": "date", "date": {"start": d} if d else None}


STUDENT_ROW = {"id": "page-ana", "properties": {
    "Student Name": _title("Ana Ruiz"), "Email": {"type": "email", "email": "ana@test.io"},
    "Enrollment Plan": _sel("Job Guarantee"), "Advisor": _sel("Valentina Ancieta"), "Cohort ID": _sel("PT-65"),
    "Program": _sel("Full-Stack"), "City": _sel("Miami"), "GeekForce Status": _ms("Active"),
    "GeekForce Stages completion": _ms("Stage 1 in progress", "Stage 3 in progress"),
    "Placement Status": _sel("To be placed"), "JG deadline date": _date("2027-03-01"),
    "Graduation date CS": _date("2026-09-01"),
    "Job hunting tracker": {"type": "relation", "relation": [{"id": "tasks-ana"}]}}}
REGULAR_ROW = {"id": "page-bo", "properties": {
    "Student Name": _title("Bo Lee"), "Email": {"type": "email", "email": "bo@test.io"},
    "Enrollment Plan": _sel("Regular Student"), "Advisor": _sel(""), "Cohort ID": _sel("DS-3"),
    "Program": _sel("Data Science & ML"), "GeekForce Status": _ms("Active"),
    "GeekForce Stages completion": _ms("Stage 2 in progress"), "Placement Status": _sel(""),
    "Job hunting tracker": {"type": "relation", "relation": []}}}
NO_CS_ROW = {"id": "page-x", "properties": {"Student Name": _title("X"), "Email": {"type": "email", "email": "x@test.io"},
                                            "Enrollment Plan": _sel("No-CareerSupport")}}


def _app_row(i, status, d):
    return {"id": f"app-{i}", "created_time": "2026-09-01T00:00:00Z", "properties": {
        "Company": _title(f"Company {i}"), "Position": _rt("Frontend Developer"), "Status": {"type": "status", "status": {"name": status}},
        "Date Applied": _date(d), "Job URL": {"type": "url", "url": f"https://jobs/{i}"}, "Notes": _rt(""), "Next Steps": _rt("")}}


def fake_notion():
    recent = (local_today() - timedelta(days=5)).isoformat()
    old = (local_today() - timedelta(days=60)).isoformat()
    apps = [_app_row(1, "Applied", recent), _app_row(2, "Technical Assessment", recent), _app_row(3, "Rejected", old)]

    def handler(req: httpx.Request):
        p = req.url.path
        if p.endswith("/query") and "f6fd23c5" in p:
            return httpx.Response(200, json={"results": [STUDENT_ROW, REGULAR_ROW, NO_CS_ROW], "has_more": False})
        if p == "/v1/blocks/tasks-ana/children":
            return httpx.Response(200, json={"results": [{"id": "sub", "type": "child_page", "has_children": True,
                                                          "child_page": {"title": "Job Hunting Tracker"}}], "has_more": False})
        if p == "/v1/blocks/sub/children":
            return httpx.Response(200, json={"results": [{"id": "db-ana", "type": "child_database", "has_children": False,
                                                          "child_database": {"title": "Job Application Tracker"}}], "has_more": False})
        if p == "/v1/databases/db-ana":
            return httpx.Response(200, json={"data_sources": [{"id": "ds-ana", "name": "Job Application Tracker"}]})
        if p == "/v1/data_sources/ds-ana/query":
            return httpx.Response(200, json={"results": apps, "has_more": False})
        return httpx.Response(404, json={"message": p})
    return NotionClient("test-token", transport=httpx.MockTransport(handler))


def test_mappers():
    assert map_stage(["Stage 1 in progress", "Stage 3 in progress"], "") == "job_hunting"
    assert map_stage(["Stage 2 in progress"], "Placed") == "placed"
    assert student_from_page(NO_CS_ROW) is None
    a = application_from_page(_app_row(9, "Final Interview", "2026-09-10"))
    assert a["status"] == "final" and a["company"] == "Company 9"


def test_notion_sync_creates_onboarding_students_with_history(db, people):
    res = run_sync(db, nc=fake_notion())
    assert res["ok"] and res["created"] == 2 and res["skipped"] == 1 and res["applications_imported"] == 3
    ana = db.scalar(select(Student).join(User, Student.user_id == User.id).where(User.email == "ana@test.io"))
    assert ana.status == "onboarding" and ana.stage == "job_hunting" and ana.enrollment_plan == "job_guarantee"
    assert ana.advisor_id == people["advisor"].id and ana.deadline_date.isoformat() == "2027-03-01"
    bo = db.scalar(select(Student).join(User, Student.user_id == User.id).where(User.email == "bo@test.io"))
    assert bo.guarantee_status == "not_eligible" and bo.enrollment_plan == "professional_support"
    # no points for imported history; the advisor sets the starting balance
    assert db.scalar(select(PointsEvent).where(PointsEvent.student_id == ana.id)) is None
    sug = engine.suggested_starting_balance(db, ana)
    assert sug["applications_last_30_days"] == 2 and sug["suggested"] == 86
    # re-running is idempotent
    res2 = run_sync(db, nc=fake_notion())
    assert res2["created"] == 0 and res2["updated"] == 2 and res2["applications_imported"] == 0  # already imported: no duplicates
    assert db.query(Application).filter(Application.student_id == ana.id).count() == 3


def test_activation_sets_balance_and_invites(client, db, people):
    run_sync(db, nc=fake_notion())
    ana = db.scalar(select(Student).join(User, Student.user_id == User.id).where(User.email == "ana@test.io"))
    h = auth(people["advisor"])
    onb = client.get("/api/v1/advisor/onboarding", headers=h).json()
    assert {o["email"] for o in onb} >= {"ana@test.io"}
    r = client.post(f"/api/v1/advisor/students/{ana.id}/activate", headers=h, json={"starting_points": 86})
    assert r.status_code == 200, r.text
    link = r.json()["invite_link"]
    assert "/set-password?token=" in link and r.json()["student"]["points"] == 86
    token = link.split("token=")[1]
    assert client.get(f"/api/v1/auth/set-password/check?token={token}").json()["email"] == "ana@test.io"
    assert client.post("/api/v1/auth/set-password", json={"token": token, "password": "short"}).status_code == 422
    ok = client.post("/api/v1/auth/set-password", json={"token": token, "password": "a-good-password"})
    assert ok.status_code == 200 and ok.json()["token"]
    # single use
    assert client.post("/api/v1/auth/set-password", json={"token": token, "password": "another-pass"}).status_code == 400
    login = client.post("/api/v1/auth/login", json={"email": "ana@test.io", "password": "a-good-password"})
    assert login.status_code == 200
    db.expire_all()
    assert db.get(Student, ana.id).status == "active"
    # after activation, the sync no longer imports applications for her
    assert run_sync(db, nc=fake_notion())["applications_imported"] == 0
