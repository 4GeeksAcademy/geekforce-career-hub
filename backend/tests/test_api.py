from tests.conftest import auth


def test_login_and_dashboard(client, people):
    r = client.post("/api/v1/auth/login", json={"email": "stu@test.io", "password": "secret123"})
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    d = client.get("/api/v1/students/me/dashboard", headers={"Authorization": f"Bearer {tok}"})
    assert d.status_code == 200, d.text
    body = d.json()
    assert body["points"] == 80 and body["status"] == "secured"
    assert body["week"]["target"] == 15
    assert len(body["conditions"]) == 7


def test_bad_login(client, people):
    r = client.post("/api/v1/auth/login", json={"email": "stu@test.io", "password": "nope"})
    assert r.status_code == 401


def test_extension_flow(client, people):
    h = auth(people["student_user"])
    r = client.post("/api/v1/applications", headers=h, json={
        "company": "Spotify", "role": "Frontend Developer", "job_url": "https://linkedin.com/jobs/1",
        "source": "extension_linkedin"})
    assert r.status_code == 201, r.text
    assert r.json()["points"] == 83 and r.json()["this_week"] == 1
    again = client.post("/api/v1/applications", headers=h, json={
        "company": "Spotify", "role": "Frontend Developer", "job_url": "https://linkedin.com/jobs/1",
        "source": "extension_linkedin"})
    assert again.json()["created"] is False
    app_id = r.json()["application"]["id"]
    undo = client.delete(f"/api/v1/applications/{app_id}", headers=h)
    assert undo.json()["points"] == 80


def test_permissions(client, people, db):
    from app.auth import hash_password
    from app.models import User
    other = User(email="other@test.io", name="Other Advisor", role="advisor", password_hash=hash_password("x"))
    db.add(other)
    db.commit()
    sid = people["student"].id
    assert client.get(f"/api/v1/students/{sid}/dashboard", headers=auth(people["advisor"])).status_code == 200
    assert client.get(f"/api/v1/students/{sid}/dashboard", headers=auth(other)).status_code == 403
    assert client.get(f"/api/v1/students/{sid}/dashboard", headers=auth(people["admin"])).status_code == 200
    assert client.put("/api/v1/admin/rules", headers=auth(people["advisor"]),
                      json={"values": {"pts_application": 4}}).status_code == 403


def test_rules_are_editable(client, people):
    r = client.put("/api/v1/admin/rules", headers=auth(people["admin"]), json={"values": {"pts_application": 4}})
    assert r.status_code == 200
    h = auth(people["student_user"])
    res = client.post("/api/v1/applications", headers=h, json={"company": "A", "role": "B"})
    assert res.json()["points"] == 84


def test_session_preview_and_log(client, people):
    h = auth(people["advisor"])
    sid = people["student"].id
    payload = {"student_id": sid, "session_date": "2026-10-13T14:00:00Z", "session_type": "one_on_one",
               "attendance": "attended", "summary": "Good session",
               "homework": [{"description": "Publish a post", "due_date": "2026-10-20"}]}
    p = client.post("/api/v1/advisor/sessions/preview", headers=h, json=payload)
    assert p.status_code == 200, p.text
    assert p.json()["balance_after"] == 100
    s = client.post("/api/v1/advisor/sessions", headers=h, json=payload)
    assert s.status_code == 201, s.text
    assert s.json()["points"] == 100
    sessions = client.get(f"/api/v1/students/{sid}/sessions", headers=auth(people["student_user"])).json()
    assert sessions[0]["homework"][0]["description"] == "Publish a post"


def test_admin_creates_student(client, people):
    r = client.post("/api/v1/admin/users", headers=auth(people["admin"]), json={
        "email": "new@test.io", "name": "New Student", "role": "student", "cohort_id": people["cohort"].id,
        "advisor_id": people["advisor"].id})
    assert r.status_code == 201, r.text
    assert r.json()["temporary_password"]
    assert r.json()["student"]["points"] == 80


def test_cron_requires_secret(client, people):
    assert client.post("/api/v1/cron/daily").status_code == 401
