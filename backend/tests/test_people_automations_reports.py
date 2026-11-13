from datetime import timedelta

import pytest
from sqlalchemy import select

from app import automations as A, events
from app.auth import hash_password
from app.models import (Application, AuditLog, Automation, AutomationRun, Job, JobShare, PointsEvent, Student, User)
from app.timeutil import now_utc

from .conftest import auth


# ── people ──

def test_edit_user_name_email_role(client, db, people):
    adm, adv = people["admin"], people["advisor"]
    r = client.patch(f"/api/v1/admin/users/{adv.id}", json={"name": "Vale A.", "email": "VALE@test.io", "role": "admin"},
                     headers=auth(adm))
    assert r.status_code == 200, r.text
    assert r.json()["email"] == "vale@test.io" and r.json()["role"] == "admin"
    # staff ↔ student is blocked with an explanation
    r = client.patch(f"/api/v1/admin/users/{adv.id}", json={"role": "student"}, headers=auth(adm))
    assert r.status_code == 422 and "different records" in r.json()["detail"]
    # duplicate email
    r = client.patch(f"/api/v1/admin/users/{adv.id}", json={"email": "stu@test.io"}, headers=auth(adm))
    assert r.status_code == 409
    # advisors can't edit people
    other = User(email="adv2@test.io", name="Adv Two", role="advisor", password_hash="x")
    db.add(other)
    db.commit()
    assert client.patch(f"/api/v1/admin/users/{adv.id}", json={"name": "x"}, headers=auth(other)).status_code == 403


def test_last_admin_and_self_protected(client, db, people):
    adm = people["admin"]
    r = client.patch(f"/api/v1/admin/users/{adm.id}", json={"role": "advisor"}, headers=auth(adm))
    assert r.status_code == 422 and "last admin" in r.json()["detail"]
    r = client.post(f"/api/v1/admin/users/{adm.id}/remove", json={}, headers=auth(adm))
    assert r.status_code == 422


def test_remove_advisor_needs_reassign_then_archives(client, db, people):
    adm, adv, st = people["admin"], people["advisor"], people["student"]
    r = client.post(f"/api/v1/admin/users/{adv.id}/remove", json={}, headers=auth(adm))
    assert r.status_code == 422 and "advises 1" in r.json()["detail"]
    r = client.post(f"/api/v1/admin/users/{adv.id}/remove", json={"reassign_to": adm.id}, headers=auth(adm))
    assert r.status_code == 200 and r.json()["archived"] and r.json()["reassigned"] == 1
    db.expire_all()
    assert db.get(Student, st.id).advisor_id == adm.id
    u = db.get(User, adv.id)
    assert u.archived_at and not u.is_active
    ids = [x["id"] for x in client.get("/api/v1/admin/users", headers=auth(adm)).json()]
    assert adv.id not in ids
    arch = [x["id"] for x in client.get("/api/v1/admin/users?archived=true", headers=auth(adm)).json()]
    assert adv.id in arch
    # archived people can't sign in
    assert client.post("/api/v1/auth/login", json={"email": "adv@test.io", "password": "secret123"}).status_code in (401, 403)
    assert client.post(f"/api/v1/admin/users/{adv.id}/restore", headers=auth(adm)).json()["is_active"] is True


def test_permanent_delete_only_without_history(client, db, people):
    adm, st = people["admin"], people["student"]
    db.add(PointsEvent(student_id=st.id, event_type="x", delta=1, applied_delta=1, balance_after=81, title="x"))
    db.commit()
    r = client.post(f"/api/v1/admin/users/{people['student_user'].id}/remove", json={"permanent": True}, headers=auth(adm))
    assert r.status_code == 422 and "archived" in r.json()["detail"]
    nu = User(email="new@test.io", name="Typo Person", role="advisor", password_hash=hash_password("secret123"))
    db.add(nu)
    db.commit()
    assert client.get(f"/api/v1/admin/users/{nu.id}", headers=auth(adm)).json()["history"]["sessions_led"] == 0
    nid = nu.id
    r = client.post(f"/api/v1/admin/users/{nid}/remove", json={"permanent": True}, headers=auth(adm))
    assert r.status_code == 200 and r.json()["deleted"]
    db.expunge_all()
    assert db.get(User, nid) is None
    assert db.scalar(select(AuditLog).where(AuditLog.action == "user_deleted"))


# ── automations ──

@pytest.fixture()
def sent(monkeypatch):
    calls = []

    def fake(a, body, transport=None):
        calls.append({"url": a.webhook_url, "secret": a.secret, "body": body})
        return {"status": "ok", "http_status": 200, "response": '{"ok":true}', "duration_ms": 5}
    monkeypatch.setattr(A, "post_webhook", fake)
    monkeypatch.setattr(events._pool, "submit", lambda fn, *a: fn(*a))
    return calls


def test_automation_crud_run_and_callback(client, db, people, sent):
    adm, adv, st = people["admin"], people["advisor"], people["student"]
    r = client.post("/api/v1/automations", json={"name": "Send welcome pack", "scope": "student",
                                                 "n8n_workflow_id": "abc123", "allow_advisors": True}, headers=auth(adm))
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["link"] == "https://n8n.4geeks.com/workflow/abc123" and a["secret"]
    # no webhook yet → clear message
    r = client.post(f"/api/v1/automations/{a['id']}/run", json={"student_id": st.id}, headers=auth(adv))
    assert r.status_code == 422 and "Webhook" in r.json()["detail"]
    client.patch(f"/api/v1/automations/{a['id']}", json={"webhook_url": "https://n8n.4geeks.com/webhook/welcome"},
                 headers=auth(adm))
    # scope requires a student
    assert client.post(f"/api/v1/automations/{a['id']}/run", json={}, headers=auth(adv)).status_code == 422
    r = client.post(f"/api/v1/automations/{a['id']}/run", json={"student_id": st.id, "params": {"note": "hi"}},
                    headers=auth(adv))
    assert r.status_code == 200 and r.json()["status"] == "ok", r.text
    assert sent[-1]["body"]["student"]["email"] == "stu@test.io" and sent[-1]["body"]["params"] == {"note": "hi"}
    assert sent[-1]["secret"] == a["secret"]
    # advisors don't see the secret or webhook URL
    lst = client.get("/api/v1/automations", headers=auth(adv)).json()
    assert lst[0]["secret"] is None and lst[0]["webhook_url"] is True
    # callback
    assert client.post(f"/api/v1/integrations/automations/{a['id']}/callback", json={"status": "ok"},
                       headers={"X-GeekForce-Secret": "wrong"}).status_code == 401
    r = client.post(f"/api/v1/integrations/automations/{a['id']}/callback",
                    json={"status": "ok", "message": "Found 12 jobs", "items": 12},
                    headers={"X-GeekForce-Secret": a["secret"]})
    assert r.status_code == 200
    runs = client.get(f"/api/v1/automations/runs?automation_id={a['id']}", headers=auth(adm)).json()
    assert [x["source"] for x in runs] == ["callback", "manual"]
    assert runs[0]["response"] == "Found 12 jobs" and runs[1]["triggered_by"] == "Valentina Ancieta"


def test_event_trigger_fires_subscribed_automation(client, db, people, sent):
    adm, adv, st = people["admin"], people["advisor"], people["student"]
    a = Automation(name="Shared job alert", webhook_url="https://n8n.example/webhook/x", secret="s3cret",
                   events=["job_shared"], scope="none", allow_advisors=True, active=True)
    job = Job(source="manual", external_id="m1", title="AI Engineer", company="Acme", country="ES")
    db.add_all([a, job])
    db.commit()
    r = client.post(f"/api/v1/advisor/jobs/{job.id}/share", json={"student_ids": [st.id]}, headers=auth(adv))
    assert r.status_code == 200, r.text
    assert any(c["body"]["event"] == "job_shared" and c["body"]["data"]["job"]["country"] == "ES" for c in sent)
    db.expire_all()
    run = db.scalar(select(AutomationRun).where(AutomationRun.automation_id == a.id))
    assert run and run.source == "event" and run.event == "job_shared"


def test_ingest_accepts_n8n_and_country(client, db, people, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "jobs_ingest_secret", "ing")
    r = client.post("/api/v1/integrations/jobs", headers={"X-Jobs-Secret": "ing"},
                    json={"source": "n8n", "jobs": [{"title": "AI Engineer", "company": "Glovo", "country": "España",
                                                     "url": "https://x.es/1"}]})
    assert r.status_code == 200, r.text
    j = db.scalar(select(Job).where(Job.company == "Glovo"))
    assert j.country == "ES" and j.source == "n8n"
    lst = client.get("/api/v1/advisor/jobs?country=ES", headers=auth(people["advisor"])).json()
    assert [x["company"] for x in lst["items"]] == ["Glovo"] and lst["countries"] == {"ES": 1}


# ── dashboards ──

def test_reports_and_dashboards(client, db, people):
    adm, adv, st = people["admin"], people["advisor"], people["student"]
    other_user = User(email="o@test.io", name="Other", role="student", password_hash="x")
    db.add(other_user)
    db.flush()
    other = Student(user_id=other_user.id, cohort_id=people["cohort"].id, advisor_id=adm.id, career_points=50)
    db.add(other)
    db.flush()
    for i, s in enumerate(["applied", "interview", "offer"]):
        db.add(Application(student_id=st.id, company=f"C{i}", role="Dev", status=s, applied_at=now_utc() - timedelta(days=i)))
    db.add(Application(student_id=other.id, company="Z", role="Dev", status="applied"))
    db.commit()

    q = lambda body, who: client.post("/api/v1/reports/query", json=body, headers=auth(who))
    r = q({"dataset": "applications", "metric": "count"}, adm)
    assert r.status_code == 200 and r.json()["total"] == 4, r.text
    assert q({"dataset": "applications", "metric": "count"}, adv).json()["total"] == 3  # own students only
    r = q({"dataset": "applications", "metric": "count", "group_by": "advisor", "split_by": "app_status"}, adm).json()
    assert {(x["x"], x["series"]) for x in r["rows"]} >= {("Valentina Ancieta", "offer"), ("Admin", "applied")}
    r = q({"dataset": "applications", "metric": "count", "group_by": "time:day"}, adm).json()
    assert sum(x["value"] for x in r["rows"]) == 4
    r = q({"config": {"dataset": "applications", "metric": "offers"},
           "dashboard_filters": {"advisor": ["Valentina Ancieta"]}}, adm).json()
    assert r["total"] == 1
    assert q({"dataset": "students", "metric": "avg_points"}, adm).json()["total"] == 65
    assert q({"dataset": "nope"}, adm).status_code == 422
    assert "Valentina Ancieta" in client.get("/api/v1/reports/values?dataset=students&dim=advisor", headers=auth(adm)).json()

    # default dashboard is created on first visit, and every widget runs
    ds = client.get("/api/v1/dashboards", headers=auth(adv)).json()
    assert len(ds) == 1
    d = client.get(f"/api/v1/dashboards/{ds[0]['id']}", headers=auth(adv)).json()
    assert len(d["widgets"]) >= 8
    for w in d["widgets"]:
        r = q({"config": w["config"], "dashboard_filters": {"cohort": ["FS #47"], "date_from": "2020-01-01"}}, adv)
        assert r.status_code == 200, (w["title"], r.text)
    # widgets, filters, sharing
    w = client.post(f"/api/v1/dashboards/{d['id']}/widgets", json={"title": "Offers", "width": 1,
                    "config": {"dataset": "applications", "metric": "offers", "chart": "number"}}, headers=auth(adv))
    assert w.status_code == 201
    r = client.patch(f"/api/v1/dashboards/{d['id']}", json={"filters": {"program": ["Full Stack"], "x": ""}, "shared": True},
                     headers=auth(adv)).json()
    assert r["filters"] == {"program": ["Full Stack"]} and r["shared"]
    # admin sees the shared one; another advisor can view but not edit
    adv2 = User(email="a2@test.io", name="Adv Two", role="advisor", password_hash="x")
    db.add(adv2)
    db.commit()
    assert client.get(f"/api/v1/dashboards/{d['id']}", headers=auth(adv2)).status_code == 200
    assert client.delete(f"/api/v1/dashboards/{d['id']}", headers=auth(adv2)).status_code == 403
    copy = client.post("/api/v1/dashboards", json={"name": "Mine", "copy_from": d["id"]}, headers=auth(adv2)).json()
    assert len(copy["widgets"]) == len(d["widgets"]) + 1
