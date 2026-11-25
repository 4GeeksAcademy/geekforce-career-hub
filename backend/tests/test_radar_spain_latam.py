"""Job Radar for Spain and LATAM: Adzuna per country, matching by region, and no company contacts for students."""
import httpx
from sqlalchemy import select

from app import job_radar as JR
from app.config import settings
from app.models import Cohort, Job, Student, User

from .conftest import auth


def _spain_student(db, people):
    c = Cohort(name="ES-FS-3", program="Full Stack", region="spain", deadline_days=90)
    u = User(email="es@test.io", name="Lucía Pérez", role="student", password_hash="x")
    db.add_all([c, u])
    db.flush()
    st = Student(user_id=u.id, cohort_id=c.id, advisor_id=people["advisor"].id, career_points=40, stage="job_hunting")
    db.add(st)
    people["student"].stage = "job_hunting"
    db.commit()
    return st


def test_adzuna_sweeps_each_country_in_its_language(db, people, monkeypatch):
    monkeypatch.setattr(settings, "adzuna_app_id", "id")
    monkeypatch.setattr(settings, "adzuna_app_key", "key")
    monkeypatch.setattr(settings, "adzuna_countries", "us,es")
    monkeypatch.setattr(JR, "TITLE_SETS", {"full_stack": ["junior web developer"]})
    monkeypatch.setattr(JR, "TITLE_SETS_ES", {"full_stack": ["desarrollador junior"]})
    seen = []

    def handler(req):
        country = req.url.path.split("/")[4]
        seen.append((country, req.url.params["what"]))
        if country == "es":
            return httpx.Response(200, json={"results": [
                {"id": 10, "title": "Desarrollador <strong>Junior</strong> React", "company": {"display_name": "Glovo"},
                 "location": {"display_name": "Barcelona"}, "redirect_url": "https://adzuna.es/10"},
                {"id": 11, "title": "Jefe de Desarrollo", "company": {"display_name": "Big"}, "redirect_url": "https://adzuna.es/11"}]})
        return httpx.Response(200, json={"results": [
            {"id": 20, "title": "Junior Web Developer", "company": {"display_name": "Palmway"}, "redirect_url": "https://adzuna/20"}]})

    res = JR.sweep_adzuna(db, transport=httpx.MockTransport(handler))
    assert seen == [("us", "junior web developer"), ("es", "desarrollador junior")]
    assert res["created"] == 2 and res["skipped_senior"] == 1 and res["created_by_country"] == {"US": 1, "ES": 1}
    es = db.scalar(select(Job).where(Job.company == "Glovo"))
    assert es.country == "ES" and es.program == "full_stack" and es.title == "Desarrollador Junior React"
    assert db.scalar(select(Job).where(Job.company == "Palmway")).country == "US"


def test_spanish_titles_get_a_program():
    assert JR.program_for_title("Analista de Datos Junior") == "data_science"
    assert JR.program_for_title("Programador Full Stack") == "full_stack"
    assert JR.program_for_title("Ingeniero de IA") == "ai_engineering"
    assert JR.program_for_title("Técnico de Ciberseguridad") == "cybersecurity"
    assert JR.SENIOR.search("Desarrollador Sénior") and JR.SENIOR.search("Gerente de TI")


def test_fits_only_count_students_in_the_jobs_region(client, db, people, monkeypatch):
    es_student = _spain_student(db, people)
    monkeypatch.setattr(settings, "jobs_ingest_secret", "ing")
    client.post("/api/v1/integrations/jobs", headers={"X-Jobs-Secret": "ing"}, json={"source": "n8n", "jobs": [
        {"title": "Desarrollador Junior", "company": "Glovo", "country": "España", "url": "https://x.es/1"},
        {"title": "Junior Developer", "company": "Palmway", "country": "US", "url": "https://x.com/2"},
        {"title": "Junior Developer", "company": "Nowhere", "url": "https://x.com/3"}]})
    h = auth(people["advisor"])
    items = {j["company"]: j for j in client.get("/api/v1/advisor/jobs", headers=h).json()["items"]}
    assert items["Glovo"]["fits"] == 1 and items["Palmway"]["fits"] == 1 and items["Nowhere"]["fits"] == 2
    es_job = db.scalar(select(Job).where(Job.company == "Glovo"))
    fits = client.get(f"/api/v1/advisor/jobs/{es_job.id}/fits", headers=h).json()["students"]
    assert [s["id"] for s in fits] == [es_student.id]
    mx_job = Job(source="manual", external_id="mx1", title="Junior Developer", company="Kavak", country="MX",
                 program="full_stack")
    db.add(mx_job)
    db.commit()
    assert JR.candidates(db, mx_job) == []  # nobody in a LATAM cohort yet


def test_students_never_see_company_contacts(client, db, people, monkeypatch):
    st = people["student"]
    st.stage = "job_hunting"
    db.commit()
    monkeypatch.setattr(settings, "jobs_ingest_secret", "ing")
    client.post("/api/v1/integrations/jobs", headers={"X-Jobs-Secret": "ing"}, json=[
        {"title": "Junior Frontend Developer", "company": "Palmway", "url": "https://x.com/9",
         "contact_name": "Jane Recruiter", "contact_handle": "@jane", "outreach_status": "contacted",
         "notes": "internal note"}])
    job = db.scalar(select(Job).where(Job.company == "Palmway"))
    h = auth(people["advisor"])
    assert client.post(f"/api/v1/advisor/jobs/{job.id}/share", headers=h, json={"student_ids": [st.id]}).json()["shared"] == 1
    mine = client.get(f"/api/v1/students/{st.id}/jobs", headers=auth(people["student_user"])).json()
    shared = mine[0]["job"]
    assert shared["company"] == "Palmway" and shared["url"] == "https://x.com/9"
    for k in ("contact_name", "contact_handle", "outreach_status", "notes"):
        assert k not in shared
    staff_view = client.get(f"/api/v1/students/{st.id}/jobs", headers=h).json()[0]["job"]
    assert staff_view["contact_name"] == "Jane Recruiter"
