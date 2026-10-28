"""Resume builder v2: copy-paste AI for students, approval gate, weekly cap, staff AI under budget."""
import io
import json

from docx import Document
from sqlalchemy import select

from app.config import settings
from app.models import AiUsage, PointsEvent, ProfileTask, ResumeSnapshot, RuleSetting
from app.services import resume_ai as R

from .conftest import auth

RESUME = {
    "basics": {"name": "Maria González", "headline": "Full Stack Developer", "email": "stu@test.io",
               "location": "Miami, FL"},
    "summary": "Career changer who builds React and Flask apps.",
    "skills": [{"group": "Frontend", "items": ["React", "JavaScript"]}, {"group": "Backend", "items": ["Python", "Flask"]}],
    "experience": [{"title": "Store Manager", "company": "Publix", "start": "2019", "end": "2024",
                    "bullets": ["Led a team of 12", "Cut stock-outs by 30% with a spreadsheet tracker"]}],
    "projects": [{"name": "TripMate", "tech": "React, Flask, PostgreSQL", "bullets": ["Trip planner with 40 users"]}],
    "education": [{"school": "4Geeks Academy", "degree": "Full Stack Development", "end": "2025"}],
}
JOB = ("Junior Frontend Developer at Acme. You will build React components, write TypeScript, work with REST APIs "
       "and collaborate with designers. Nice to have: testing with Jest, accessibility.")


def _seed(client, h):
    answer = "Here is your resume:\n```json\n" + json.dumps(RESUME) + "\n```"
    r = client.post("/api/v1/students/me/resume/import", headers=h, json={"answer": answer})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def test_student_flow_prompt_import_tailor_and_approval_gate(client, db, people):
    h = auth(people["student_user"])
    first = client.get("/api/v1/students/me/resume", headers=h).json()
    assert first["is_empty"] and first["can_download"] is False and first["ai"]["available"] is False
    assert first["data"]["basics"]["email"] == "stu@test.io"

    data = _seed(client, h)
    assert data["experience"][0]["company"] == "Publix"

    # tailoring is a copy-paste prompt: no tokens of ours
    p = client.post("/api/v1/students/me/resume/tailor/prompt", headers=h, json={"job_text": JOB}).json()
    assert "Junior Frontend Developer" in p["prompt"] and "Publix" in p["prompt"]
    ans = {"match_score": 72, "missing_keywords": ["TypeScript", "Jest"], "summary_of_fit": "Good React base.",
           "changes": [
               {"path": "basics.headline", "after": "Junior Frontend Developer (React)", "reason": "Match title"},
               {"path": "skills.0.items.+", "after": "TypeScript", "reason": "In the job"},
               {"path": "experience.7.bullets.0", "after": "Invented", "reason": "bad path"},
           ]}
    rev = client.post("/api/v1/students/me/resume/tailor/review", headers=h, json={"answer": json.dumps(ans)}).json()
    assert len(rev["changes"]) == 2 and rev["match_score"] == 72
    applied = client.post("/api/v1/students/me/resume/tailor/apply", headers=h, json={"changes": rev["changes"]}).json()["data"]
    assert applied["basics"]["headline"].startswith("Junior Frontend") and "TypeScript" in applied["skills"][0]["items"]

    v = client.post("/api/v1/students/me/resume/versions", headers=h, json={
        "label": "Acme · Junior Frontend", "data": applied, "template": "modern", "company": "Acme",
        "job_title": "Junior Frontend Developer", "analysis": rev})
    assert v.status_code == 201
    vid = v.json()["id"]

    # not approved yet → no download
    assert client.get("/api/v1/students/me/resume/docx", headers=h).status_code == 403
    assert client.post("/api/v1/students/me/resume/submit", headers=h).json()["status"] == "in_review"

    # advisor asks for changes, then approves
    ha, sid = auth(people["advisor"]), people["student"].id
    assert client.post(f"/api/v1/advisor/students/{sid}/resume/request-changes", headers=ha,
                       json={"note": "Add numbers to the TripMate bullet"}).status_code == 200
    got = client.get("/api/v1/students/me/resume", headers=h).json()
    assert got["status"] == "changes_requested" and got["comments"][0]["body"].startswith("Add numbers")
    assert client.post(f"/api/v1/advisor/students/{sid}/resume/approve", headers=ha, json={}).status_code == 200
    assert db.scalar(select(ProfileTask).where(ProfileTask.student_id == sid, ProfileTask.task == "cv"))

    # after the first approval: any version downloads, even after more edits
    client.put("/api/v1/students/me/resume", headers=h, json={"data": applied, "template": "technical"})
    r = client.get(f"/api/v1/students/me/resume/docx?version={vid}", headers=h)
    assert r.status_code == 200 and "Acme" in r.headers["content-disposition"]
    text = "\n".join(p.text for p in Document(io.BytesIO(r.content)).paragraphs)
    assert "Junior Frontend Developer (React)" in text and "Publix" in text
    assert client.get("/api/v1/students/me/resume/docx", headers=h).status_code == 200
    assert db.get(ResumeSnapshot, vid).downloads == 1


def test_weekly_cap_for_students_only(client, db, people):
    h = auth(people["student_user"])
    data = _seed(client, h)
    for i in range(5):
        assert client.post("/api/v1/students/me/resume/versions", headers=h,
                           json={"label": f"Job {i}", "data": data}).status_code == 201
    r = client.post("/api/v1/students/me/resume/versions", headers=h, json={"label": "Job 6", "data": data})
    assert r.status_code == 429
    sid = people["student"].id
    assert client.post(f"/api/v1/students/{sid}/resume/versions", headers=auth(people["advisor"]),
                       json={"label": "Advisor version", "data": data}).status_code == 201


def test_students_cannot_use_our_ai(client, db, people):
    h, sid = auth(people["student_user"]), people["student"].id
    assert client.post(f"/api/v1/advisor/students/{sid}/resume/ai/tailor", headers=h, json={"job_text": JOB}).status_code == 403
    assert client.post("/api/v1/resume/analyze", headers=h).status_code == 410


def test_staff_ai_is_logged_and_budgeted(client, db, people, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    ans = {"match_score": 80, "missing_keywords": [], "summary_of_fit": "ok",
           "changes": [{"path": "basics.headline", "after": "Frontend Developer", "reason": "title"}]}
    monkeypatch.setattr(R, "run_claude", lambda prompt, max_tokens=4000: (json.dumps(ans), 100_000, 20_000))
    _seed(client, auth(people["student_user"]))
    ha, sid = auth(people["advisor"]), people["student"].id
    r = client.post(f"/api/v1/advisor/students/{sid}/resume/ai/tailor", headers=ha, json={"job_text": JOB})
    assert r.status_code == 200 and r.json()["changes"][0]["after"] == "Frontend Developer"
    u = db.scalar(select(AiUsage))
    assert u.input_tokens == 100_000 and abs(u.cost_usd - (0.3 + 0.3)) < 1e-6
    # budget used up → 402, students' copy-paste flow unaffected
    db.add(RuleSetting(key="ai_staff_monthly_budget_usd", value=0.5))
    db.commit()
    assert client.post(f"/api/v1/advisor/students/{sid}/resume/ai/tailor", headers=ha, json={"job_text": JOB}).status_code == 402
    studio = client.get("/api/v1/advisor/resumes", headers=ha).json()
    assert studio["items"][0]["status"] == "draft" and studio["ai"]["spent_usd"] == 0.6


def test_templates_build_and_ats_safe():
    data = R.normalize(RESUME)
    for t in R.TEMPLATES:
        doc = Document(io.BytesIO(R.build_docx(data, t)))
        assert not doc.tables  # single column, no tables: parses cleanly in applicant tracking systems
        assert "Maria González" in doc.paragraphs[0].text


def test_template_library(client, db, people):
    ha, hs = auth(people["advisor"]), auth(people["student_user"])
    r = client.post("/api/v1/advisor/resume-templates", headers=ha, json={
        "name": "AI Engineer · career changer", "program": "AI Engineering", "layout": "technical", "active": False, "data": RESUME})
    assert r.status_code == 201
    t = r.json()
    assert t["data"]["basics"]["name"] == "" and t["data"]["basics"]["email"] == ""  # contact details stripped
    assert t["data"]["experience"][0]["company"] == "Publix"
    assert client.get("/api/v1/resume/templates", headers=hs).json() == []  # hidden from students
    assert len(client.get("/api/v1/resume/templates?all=true", headers=ha).json()) == 1
    assert client.get("/api/v1/resume/templates?all=true", headers=hs).json() == []  # students can't see hidden ones
    client.put(f"/api/v1/advisor/resume-templates/{t['id']}", headers=ha, json={**t, "active": True})
    assert [x["name"] for x in client.get("/api/v1/resume/templates", headers=hs).json()] == ["AI Engineer · career changer"]
    assert client.post("/api/v1/advisor/resume-templates", headers=hs, json={"name": "x" * 3, "data": RESUME}).status_code == 403
    p = client.post("/api/v1/advisor/resume-templates/parse", headers=ha, json={"answer": json.dumps(RESUME)}).json()
    assert p["data"]["basics"]["email"] == "" and p["data"]["summary"]
    assert client.delete(f"/api/v1/advisor/resume-templates/{t['id']}", headers=ha).status_code == 200


def test_student_can_edit_saved_version(client, db, people):
    h = auth(people["student_user"])
    data = _seed(client, h)
    data["projects"][0]["bullets"].append("Served [number] users")
    vid = client.post("/api/v1/students/me/resume/versions", headers=h, json={"label": "Acme", "data": data}).json()["id"]
    data["projects"][0]["bullets"][-1] = "Served 40 users"
    r = client.put(f"/api/v1/students/me/resume/versions/{vid}", headers=h, json={"data": data, "label": "Acme · edited"})
    assert r.status_code == 200 and r.json()["data"]["projects"][0]["bullets"][-1] == "Served 40 users"
    assert r.json()["label"] == "Acme · edited"
    other = auth(people["admin"])
    assert client.put(f"/api/v1/students/me/resume/versions/{vid}", headers=other, json={"label": "x" * 3}).status_code == 404
