"""Sharing Job Radar jobs with students in the app ("Jobs for you")."""
from sqlalchemy import select

from app.models import Application, Cohort, Job, Notification, Student, User
from app.auth import hash_password
from app.timeutil import local_today

from .conftest import auth


def _job(db):
    j = Job(source="manual", external_id="x1", url_key="acme-fe", title="Junior Frontend Developer", company="Acme",
            location="Miami, FL", url="https://acme.example/jobs/1", program="full_stack")
    db.add(j)
    db.commit()
    return j


def _second_student(db, people, cohort=None, advisor=None):
    u = User(email="luis@test.io", name="Luis Pérez", role="student", password_hash=hash_password("secret123"))
    db.add(u)
    db.flush()
    s = Student(user_id=u.id, cohort_id=(cohort or people["cohort"]).id, advisor_id=(advisor or people["advisor"]).id,
                career_points=80, guarantee_status="secured", job_search_start_date=local_today(), stage="job_hunting")
    db.add(s)
    db.commit()
    return u, s


def test_share_with_group_and_student_responds(client, db, people):
    job = _job(db)
    u2, s2 = _second_student(db, people)
    h = auth(people["advisor"])
    prev = client.post(f"/api/v1/advisor/jobs/{job.id}/share?dry_run=true", headers=h,
                       json={"cohort_id": people["cohort"].id}).json()
    assert prev["would_share"] == 2
    r = client.post(f"/api/v1/advisor/jobs/{job.id}/share", headers=h,
                    json={"cohort_id": people["cohort"].id, "note": "Strong fit for your React projects"}).json()
    assert r["shared"] == 2
    # sharing again doesn't duplicate
    assert client.post(f"/api/v1/advisor/jobs/{job.id}/share", headers=h, json={"student_ids": [s2.id]}).json()["shared"] == 0

    hs = auth(people["student_user"])
    assert client.get("/api/v1/students/me/jobs/unseen", headers=hs).json()["count"] == 1
    mine = client.get("/api/v1/students/me/jobs", headers=hs).json()
    assert len(mine) == 1 and mine[0]["job"]["title"] == "Junior Frontend Developer" and mine[0]["note"].startswith("Strong")
    assert client.get("/api/v1/students/me/jobs/unseen", headers=hs).json()["count"] == 0

    before = db.get(Student, people["student"].id).career_points
    a = client.patch(f"/api/v1/students/me/jobs/{mine[0]['id']}", headers=hs, json={"status": "applied"}).json()
    assert a["status"] == "applied" and a["logged_application"] is True
    db.expire_all()
    assert db.scalar(select(Application).where(Application.source == "job_radar")) is not None
    assert db.get(Student, people["student"].id).career_points > before
    # marking applied again doesn't log twice
    assert client.patch(f"/api/v1/students/me/jobs/{mine[0]['id']}", headers=hs, json={"status": "applied"}).json()["logged_application"] is False

    shares = client.get(f"/api/v1/advisor/jobs/{job.id}/shares", headers=h).json()
    assert sorted(s["status"] for s in shares) == ["applied", "new"]
    assert db.scalar(select(Notification).where(Notification.title.like("%applied to Junior Frontend%")))

    # Luis passes on it
    hl = auth(u2)
    lid = client.get("/api/v1/students/me/jobs", headers=hl).json()[0]["id"]
    assert client.patch(f"/api/v1/students/me/jobs/{lid}", headers=hl, json={"status": "not_a_fit", "note": "Need remote"}).status_code == 200


def test_advisor_can_only_share_with_own_students(client, db, people):
    job = _job(db)
    other = User(email="adv2@test.io", name="Other Advisor", role="advisor", password_hash=hash_password("secret123"))
    db.add(other)
    db.commit()
    r = client.post(f"/api/v1/advisor/jobs/{job.id}/share", headers=auth(other), json={"student_ids": [people["student"].id]})
    assert r.status_code == 422  # not their student: nobody to share with
    # students can't read other students' jobs
    u2, s2 = _second_student(db, people)
    assert client.get(f"/api/v1/students/{s2.id}/jobs", headers=auth(people["student_user"])).status_code == 403


def test_share_message_in_spanish_for_latam_student(client, db, people):
    job = _job(db)
    latam = Cohort(name="AI #12", program="AI Engineering", region="latam", deadline_days=90)
    db.add(latam)
    db.commit()
    u2, s2 = _second_student(db, people, cohort=latam)
    client.post(f"/api/v1/advisor/jobs/{job.id}/share", headers=auth(people["advisor"]), json={"student_ids": [s2.id]})
    n = db.scalar(select(Notification).where(Notification.user_id == u2.id))
    assert "compartió" in n.title, n.title
    me = client.get("/api/v1/auth/me", headers=auth(u2)).json()
    assert me["language"] == "es"
    client.put("/api/v1/auth/language", headers=auth(u2), json={"language": "en"})
    assert client.get("/api/v1/auth/me", headers=auth(u2)).json()["language"] == "en"
