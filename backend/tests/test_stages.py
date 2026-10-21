"""Stages: checklist, advisor moves, Notion vs hub precedence, outbound events (webhook + ActiveCampaign)."""
import json

import httpx
from sqlalchemy import select

from app import events
from app.config import settings
from app.models import AuditLog, Notification, ProfileTask, Student
from app.notion_sync import run_sync

from .conftest import auth
from .test_v1_rules import fake_notion


def test_journey_checklist_on_dashboard(client, db, people):
    st = people["student"]
    st.stage = "profile"
    db.add_all([ProfileTask(student_id=st.id, task="cv"), ProfileTask(student_id=st.id, task="linkedin")])
    db.commit()
    j = client.get(f"/api/v1/students/{st.id}/dashboard", headers=auth(people["advisor"])).json()["journey"]
    assert j["current"] == "profile" and j["next"] == "interview_prep" and not j["ready_for_next"]
    prof = [s for s in j["stages"] if s["key"] == "profile"][0]
    assert prof["state"] == "current" and prof["done_count"] == 2 and prof["total"] == 4
    assert [s["state"] for s in j["stages"]] == ["done", "current", "next", "next", "next"]


def test_advisor_moves_stage_and_events_fire(client, db, people, monkeypatch):
    sent = []
    monkeypatch.setattr(settings, "automation_webhook_url", "https://n8n.test/webhook/gf")
    monkeypatch.setattr(settings, "automation_webhook_secret", "hook")
    real_post = httpx.post

    def fake_post(url, **kw):
        if url.startswith("https://n8n.test"):
            sent.append((url, kw["json"], kw["headers"]))
            return httpx.Response(200)
        return real_post(url, **kw)
    monkeypatch.setattr(events.httpx, "post", fake_post)
    st = people["student"]
    st.stage = "profile"
    db.commit()
    h = auth(people["advisor"])
    r = client.patch(f"/api/v1/advisor/students/{st.id}/stage", headers=h,
                     json={"stage": "interview_prep", "note": "Resume and LinkedIn approved"})
    assert r.status_code == 200 and r.json()["changed"] and r.json()["journey"]["current"] == "interview_prep"
    assert len(sent) == 1
    url, body, headers = sent[0]
    assert body["event"] == "stage_changed" and body["data"]["from"] == "profile" and body["data"]["to"] == "interview_prep"
    assert body["student"]["email"] == "stu@test.io" and body["student"]["advisor"] == "Valentina Ancieta"
    assert headers["X-GeekForce-Secret"] == "hook"
    assert db.scalar(select(Notification).where(Notification.title == "You're now in Stage 2 · Interview prep"))
    assert db.scalar(select(AuditLog).where(AuditLog.action == "stage_changed"))
    # same stage again: nothing happens
    r2 = client.patch(f"/api/v1/advisor/students/{st.id}/stage", headers=h, json={"stage": "interview_prep"})
    assert r2.json()["changed"] is False and len(sent) == 1
    # status changes are events too
    client.patch(f"/api/v1/advisor/students/{st.id}/status", headers=h, json={"status": "hired"})
    assert sent[-1][1]["event"] == "status_changed" and sent[-1][1]["data"]["to"] == "hired"


def test_list_filters_by_stage(client, db, people):
    st = people["student"]
    st.stage = "job_hunting"
    db.commit()
    h = auth(people["advisor"])
    d = client.get("/api/v1/advisor/students", headers=h).json()
    assert d["stage_counts"].get("job_hunting") == 1
    assert len(client.get("/api/v1/advisor/students?stage=profile", headers=h).json()["items"]) == 0
    assert len(client.get("/api/v1/advisor/students?stage=job_hunting", headers=h).json()["items"]) == 1


def test_notion_only_overrides_when_changed_in_notion(db, people):
    run_sync(db, nc=fake_notion())
    ana = db.scalar(select(Student).where(Student.notion_page_id == "page-ana"))
    assert ana.stage == "job_hunting" and ana.notion_stage_seen == "job_hunting"
    # advisor moves her back in the hub; Notion still says Stage 3 → the hub's change stands
    from app.stages import set_stage
    set_stage(db, ana, "interview_prep", people["advisor"])
    db.commit()
    run_sync(db, nc=fake_notion())
    db.expire_all()
    assert db.get(Student, ana.id).stage == "interview_prep"


def test_activecampaign_gets_exclusive_stage_tag(monkeypatch):
    from app.services import activecampaign as ac
    from .test_stage2 import FakeAC
    monkeypatch.setattr(settings, "ac_url", "https://4geeks.api-us1.com")
    monkeypatch.setattr(settings, "ac_key", "k")
    ac._field_ids.clear(); ac._tag_ids.clear()
    fake = FakeAC()
    t = httpx.MockTransport(fake.handler)
    assert ac.push_state("a@test.io", "Ana", {"GF_STAGE": "profile"}, "secured", "profile", transport=t)
    assert ac.push_state("a@test.io", "Ana", {"GF_STAGE": "interview_prep"}, "secured", "interview_prep", transport=t)
    on = {name for name, tid in fake.tags.items() if tid in fake.contact_tags}
    assert "GF Stage 2 · Interview prep" in on and "GF Stage 1 · Profile" not in on and "GF Secured" in on
    ac._field_ids.clear(); ac._tag_ids.clear()
