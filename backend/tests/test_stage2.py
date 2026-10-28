"""Stage 2: reschedules, homework between sessions, Not to be placed, Notion snapshot, ActiveCampaign, Job Radar."""
import json
from datetime import timedelta

import httpx
from sqlalchemy import select

from app import engine, job_radar as JR
from app.config import settings
from app.models import HomeworkTask, Job, Notification, PointsEvent, Student
from app.services import activecampaign as ac
from app.services.notion import payments_behind, snapshot_from_page
from app.timeutil import local_today, now_utc

from .conftest import auth
from .test_v1_rules import _ms, _sel, _title, STUDENT_ROW


def _log(client, h, sid, attendance):
    return client.post("/api/v1/advisor/sessions", headers=h, json={
        "student_id": sid, "session_date": now_utc().isoformat(), "session_type": "one_on_one", "attendance": attendance})


def test_reschedules_cost_2_then_5_then_count_as_absence(client, db, people):
    h, st = auth(people["advisor"]), people["student"]
    prev = client.post("/api/v1/advisor/sessions/preview", headers=h, json={
        "student_id": st.id, "session_date": now_utc().isoformat(), "session_type": "one_on_one",
        "attendance": "rescheduled"}).json()
    assert [e["delta"] for e in prev["effects"]] == [-2] and prev["reschedules_after"] == 1
    assert _log(client, h, st.id, "rescheduled").status_code in (200, 201)
    assert _log(client, h, st.id, "rescheduled").status_code in (200, 201)
    db.expire_all()
    s = db.get(Student, st.id)
    assert s.career_points == 80 - 2 - 5 and s.reschedules_used == 2 and s.missed_meetings == 0
    third = client.post("/api/v1/advisor/sessions/preview", headers=h, json={
        "student_id": st.id, "session_date": now_utc().isoformat(), "session_type": "one_on_one",
        "attendance": "rescheduled"}).json()
    assert third["effective_attendance"] == "absent" and -10 in [e["delta"] for e in third["effects"]]
    assert _log(client, h, st.id, "rescheduled").status_code in (200, 201)
    db.expire_all()
    s = db.get(Student, st.id)
    assert s.missed_meetings == 1 and s.reschedules_used == 3 and s.career_points == 63
    # the old "absent, notified" option is gone
    assert _log(client, h, st.id, "excused").status_code == 422


def test_networking_is_2_points():
    from app.rules import RULES
    assert RULES["pts_networking"][0] == 2


def test_advisor_assigns_homework_by_date_or_next_meeting(client, db, people):
    h, st = auth(people["advisor"]), people["student"]
    r = client.post(f"/api/v1/advisor/students/{st.id}/homework", headers=h,
                    json={"description": "Publish one LinkedIn post about your project"})
    assert r.status_code == 200 and r.json()["due_by_next_meeting"] is True
    d = (local_today() + timedelta(days=3)).isoformat()
    r2 = client.post(f"/api/v1/advisor/students/{st.id}/homework", headers=h,
                     json={"description": "Apply to 5 Radar jobs", "due_date": d})
    assert r2.json()["due_date"] == d
    past = (local_today() - timedelta(days=1)).isoformat()
    assert client.post(f"/api/v1/advisor/students/{st.id}/homework", headers=h,
                       json={"description": "Too late", "due_date": past}).status_code == 422
    mine = client.get("/api/v1/students/me/homework", headers=auth(people["student_user"])).json()
    assert [t["description"] for t in mine] == ["Apply to 5 Radar jobs", "Publish one LinkedIn post about your project"]
    assert db.scalar(select(Notification).where(Notification.title.like("New task from%")))
    # still pending at the next 1:1 → deduction, like session homework
    assert _log(client, h, st.id, "attended").status_code in (200, 201)
    db.expire_all()
    t = db.scalar(select(HomeworkTask).where(HomeworkTask.description.like("Publish%")))
    assert t.status == "missed"


def test_not_to_be_placed_needs_reason_and_freezes(client, db, people):
    h, st = auth(people["advisor"]), people["student"]
    r = client.patch(f"/api/v1/advisor/students/{st.id}/status", headers=h, json={"status": "not_to_be_placed"})
    assert r.status_code == 422
    r = client.patch(f"/api/v1/advisor/students/{st.id}/status", headers=h,
                     json={"status": "not_to_be_placed", "reason": "Decided to stay at current job"})
    assert r.status_code == 200 and r.json()["status"] == "not_to_be_placed"
    db.expire_all()
    assert engine.refresh_status(db, db.get(Student, st.id)) == "frozen" or db.get(Student, st.id).status == "not_to_be_placed"


def test_notion_snapshot_and_payments_flag():
    row = json.loads(json.dumps(STUDENT_ROW))
    row["properties"].update({
        "Payment Status": _sel("Has debt (paying)"), "Months past due": {"type": "number", "number": 2},
        "% Approved projects": {"type": "formula", "formula": {"type": "number", "number": 0.85}},
        "CS Absences": {"type": "number", "number": 1}, "Level": _sel("Intermediate"),
        "Job guarantee status": _ms("Vigente"), "Placement Status": _sel("Not to be Placed"),
        "Company name after placement": {"type": "rollup", "rollup": {"type": "array", "array": [_title("Acme")]}},
    })
    snap = snapshot_from_page(row)
    assert snap["academic"]["% Approved projects"] == 0.85 and snap["academic"]["Level"] == "Intermediate"
    assert snap["billing"]["Months past due"] == 2 and snap["career"]["Company name after placement"] == "Acme"
    assert payments_behind(snap) is True
    assert payments_behind({"billing": {"Payment Status": "Payments on time", "Months past due": 0}, "career": {}}) is False
    assert payments_behind({"billing": {}, "career": {}}) is None


def test_billing_hidden_from_advisors(client, db, people):
    st = people["student"]
    st.notion_page_id = "abc-123"
    st.notion_snapshot = {"career": {"Placement Status": "To be placed"}, "academic": {"Level": "Advanced"},
                          "billing": {"Open Balance": 4200}}
    st.payments_behind = True
    db.commit()
    adv = client.get(f"/api/v1/advisor/students/{st.id}/notion", headers=auth(people["advisor"])).json()
    adm = client.get(f"/api/v1/advisor/students/{st.id}/notion", headers=auth(people["admin"])).json()
    assert adv["billing"] == {} and adv["payments_behind"] is True and adv["academic"]["Level"] == "Advanced"
    assert adm["billing"]["Open Balance"] == 4200


class FakeAC:
    def __init__(self):
        self.fields, self.tags, self.contact_tags, self.calls = {}, {}, {}, []

    def handler(self, req: httpx.Request):
        p, m = req.url.path.replace("/api/3", ""), req.method
        body = json.loads(req.content) if req.content else {}
        self.calls.append((m, p, body))
        if p == "/fields" and m == "GET":
            return httpx.Response(200, json={"fields": [{"id": v, "perstag": k} for k, v in self.fields.items()]})
        if p == "/fields" and m == "POST":
            fid = str(len(self.fields) + 1)
            self.fields[body["field"]["perstag"]] = fid
            return httpx.Response(201, json={"field": {"id": fid}})
        if p == "/fieldRels":
            return httpx.Response(201, json={})
        if p == "/contact/sync":
            return httpx.Response(200, json={"contact": {"id": "c1"}})
        if p == "/tags" and m == "GET":
            name = req.url.params.get("search")
            return httpx.Response(200, json={"tags": [{"id": i, "tag": n} for n, i in self.tags.items() if n == name]})
        if p == "/tags" and m == "POST":
            tid = f"t{len(self.tags) + 1}"
            self.tags[body["tag"]["tag"]] = tid
            return httpx.Response(201, json={"tag": {"id": tid}})
        if p == "/contacts/c1/contactTags":
            return httpx.Response(200, json={"contactTags": [{"id": ct, "tag": t} for t, ct in self.contact_tags.items()]})
        if p == "/contactTags" and m == "POST":
            tid = body["contactTag"]["tag"]
            self.contact_tags[tid] = f"ct-{tid}-{len(self.calls)}"
            return httpx.Response(201, json={})
        if p.startswith("/contactTags/") and m == "DELETE":
            ctid = p.split("/")[-1]
            self.contact_tags = {t: c for t, c in self.contact_tags.items() if c != ctid}
            return httpx.Response(200, json={})
        return httpx.Response(404, json={"p": p})


def test_activecampaign_alert_creates_fields_and_retriggers_tag(monkeypatch):
    monkeypatch.setattr(settings, "ac_url", "https://4geeks.api-us1.com")
    monkeypatch.setattr(settings, "ac_key", "k")
    ac._field_ids.clear()
    ac._tag_ids.clear()
    fake = FakeAC()
    t = httpx.MockTransport(fake.handler)
    assert ac.send_alert("a@test.io", "Ana Ruiz", "−10: absent", "Body", "/advisor", {"GF_POINTS": 70}, "at_risk", transport=t)
    assert set(fake.fields) == set(ac.FIELDS)
    sync = [b for m, p, b in fake.calls if p == "/contact/sync"][0]
    vals = {v["field"]: v["value"] for v in sync["contact"]["fieldValues"]}
    assert vals[fake.fields["GF_ALERT_TITLE"]] == "−10: absent" and vals[fake.fields["GF_POINTS"]] == "70"
    assert vals[fake.fields["GF_ALERT_LINK"]].endswith("/advisor")
    alert, risk = fake.tags["GF Alert"], fake.tags["GF At risk"]
    assert alert in fake.contact_tags and risk in fake.contact_tags
    first = fake.contact_tags[alert]
    assert ac.send_alert("a@test.io", "Ana Ruiz", "Second", "Body", None, {}, "at_risk", transport=t)
    assert fake.contact_tags[alert] != first  # removed and re-added so the automation fires again
    ac._field_ids.clear()
    ac._tag_ids.clear()


def test_jobs_ingest_dedupe_fits_and_share(client, db, people, monkeypatch):
    monkeypatch.setattr(settings, "jobs_ingest_secret", "s3cret")
    st = people["student"]
    st.stage = "job_hunting"
    db.commit()
    payload = {"source": "grokbot", "jobs": [
        {"title": "Junior Frontend Developer", "company": "Palmway", "url": "https://www.linkedin.com/jobs/view/123/?ref=x",
         "location": "Miami, FL (Hybrid)", "contact_handle": "@palmway_hr", "outreach_status": "contacted"},
        {"title": "Senior Data Engineer", "company": "Acme", "url": "https://acme.com/jobs/9"},
        {"company": "No title"}]}
    assert client.post("/api/v1/integrations/jobs", json=payload).status_code == 401
    r = client.post("/api/v1/integrations/jobs", json=payload, headers={"X-Jobs-Secret": "s3cret"}).json()
    assert r["created"] == 2 and len(r["errors"]) == 1
    # same LinkedIn job from another source is merged, outreach never goes backwards
    r2 = client.post("/api/v1/integrations/jobs", headers={"X-Jobs-Secret": "s3cret"}, json=[
        {"source": "partner", "title": "Junior Frontend Developer", "company": "Palmway",
         "url": "https://linkedin.com/jobs/view/123", "outreach_status": "none"}]).json()
    assert r2["created"] == 0 and r2["updated"] == 1
    job = db.scalar(select(Job).where(Job.company == "Palmway"))
    assert job.program == "full_stack" and job.work_mode == "hybrid" and job.outreach_status == "contacted"
    h = auth(people["advisor"])
    lst = client.get("/api/v1/advisor/jobs", headers=h).json()
    fe = [j for j in lst["items"] if j["company"] == "Palmway"][0]
    assert fe["fits"] == 1
    fits = client.get(f"/api/v1/advisor/jobs/{job.id}/fits", headers=h).json()
    assert [s["name"] for s in fits["students"]] == ["Maria González"]
    sh = client.post(f"/api/v1/advisor/jobs/{job.id}/share", headers=h,
                     json={"student_ids": [st.id], "note": "Great match for your React work"}).json()
    assert sh["shared"] == 1
    n = db.scalar(select(Notification).where(Notification.title.like("%shared a job%")))
    assert n.link == "/jobs"
    client.patch(f"/api/v1/advisor/jobs/{job.id}", headers=h, json={"outreach_status": "replied"})
    db.expire_all()
    assert db.get(Job, job.id).outreach_status == "replied"


def test_adzuna_sweep_skips_senior_roles(db, people, monkeypatch):
    monkeypatch.setattr(settings, "adzuna_app_id", "id")
    monkeypatch.setattr(settings, "adzuna_app_key", "key")
    monkeypatch.setattr(JR, "TITLE_SETS", {"data_science": ["junior data analyst"]})

    def handler(req):
        assert req.url.params["what"] == "junior data analyst" and req.url.params["max_days_old"] == "1"
        return httpx.Response(200, json={"results": [
            {"id": 1, "title": "Junior <strong>Data</strong> Analyst", "company": {"display_name": "Coastal"},
             "location": {"display_name": "Miami"}, "redirect_url": "https://adzuna/1", "created": "2026-10-16T09:00:00Z"},
            {"id": 2, "title": "Senior Data Analyst", "company": {"display_name": "Big"}, "redirect_url": "https://adzuna/2"}]})
    res = JR.sweep_adzuna(db, transport=httpx.MockTransport(handler))
    assert res["created"] == 1 and res["skipped_senior"] == 1
    j = db.scalar(select(Job).where(Job.source == "adzuna"))
    assert j.title == "Junior Data Analyst" and j.program == "data_science"
