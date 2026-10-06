"""Initial admin + optional demo data (SEED_DEMO=true). Demo data mirrors the approved designs."""
import logging
import os
from datetime import datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

from .auth import hash_password
from .models import (
    ActivityLog, Application, Cohort, HomeworkTask, Notification, PointsEvent, Session, Student, User,
)
from .timeutil import UTC, local_today, tz

log = logging.getLogger("geekforce.seed")
DEMO_PASSWORD = "geekforce-demo"


def ensure_initial_admin(db: DB):
    email = os.getenv("INITIAL_ADMIN_EMAIL")
    password = os.getenv("INITIAL_ADMIN_PASSWORD")
    if not email or not password:
        return
    if db.scalar(select(User).where(func.lower(User.email) == email.lower())):
        return
    db.add(User(email=email.lower(), name=os.getenv("INITIAL_ADMIN_NAME", "GeekForce Admin"), role="admin",
                password_hash=hash_password(password)))
    db.commit()
    log.info("Created initial admin %s", email)


def _at(days_ago: int, hh: int, mm: int = 0) -> datetime:
    d = local_today() - timedelta(days=days_ago)
    return datetime.combine(d, time(hh, mm), tzinfo=tz()).astimezone(UTC)


def seed_demo(db: DB):
    if db.scalar(select(func.count(Student.id))):
        return
    pw = hash_password(DEMO_PASSWORD)
    admin = User(email="admin@geekforce.demo", name="Fabiana Admin", role="admin", password_hash=pw)
    val = User(email="valentina@geekforce.demo", name="Valentina Ancieta", role="advisor", password_hash=pw)
    db.add_all([admin, val])
    fs = Cohort(name="Full Stack #47 · Miami", program="Full Stack Developer", location="Miami", region="usa",
                deadline_days=180)
    ai = Cohort(name="AI Engineering #12 · LATAM", program="AI Engineering", location="LATAM", region="latam",
                deadline_days=180)
    db.add_all([fs, ai])
    db.flush()

    def student(name, email, cohort, points, status, started_days_ago, **kw):
        u = User(email=email, name=name, role="student", password_hash=pw)
        db.add(u)
        db.flush()
        st = Student(user_id=u.id, cohort_id=cohort.id, advisor_id=val.id, career_points=points,
                     guarantee_status=status, job_search_start_date=local_today() - timedelta(days=started_days_ago),
                     last_activity_at=_at(kw.pop("idle", 0), 9), **kw)
        db.add(st)
        db.flush()
        return st

    maria = student("Maria González", "maria@geekforce.demo", fs, 74, "at_risk", 46,
                    consecutive_homework_misses=1, missed_meetings=1)
    # Maria's recent history (matches the dashboard design)
    apps = [("Spotify", "Frontend Developer", "applied", "extension_linkedin", 0, 9, 12),
            ("Microsoft", "Full Stack Engineer", "applied", "extension_indeed", 0, 8, 40),
            ("Nubank", "React Developer", "applied", "manual", 1, 18, 15),
            ("Rappi", "Junior Developer", "applied", "extension_greenhouse", 3, 9, 30),
            ("Deel", "Software Engineer", "technical", "extension_linkedin", 10, 11, 0),
            ("Mercado Libre", "Frontend Engineer", "phone_screen", "extension_glassdoor", 14, 10, 0),
            ("Globant", "Junior Full Stack", "offer", "manual", 28, 15, 0),
            ("Shopify", "Frontend Developer", "rejected", "extension_linkedin", 30, 12, 0)]
    for co, role, status, src, d, h, m in apps:
        db.add(Application(student_id=maria.id, company=co, role=role, status=status, source=src,
                           job_url=f"https://jobs.example.com/{co.lower().replace(' ', '-')}/{role.lower().replace(' ', '-')}",
                           applied_at=_at(d, h, m)))
    ledger = [("deduction_weekly", -10, "Weekly goal missed · 12 of 15 applications", "weekly_check", 67, 3, 6, 0),
              ("application", 3, "Applied · Junior Developer at Rappi", "extension", 70, 3, 9, 30),
              ("deduction_absence", -10, "Session missed without notice", "advisor", 60, 2, 19, 0),
              ("meeting", 20, "1:1 meeting attended", "advisor", 80, 1, 10, 0),
              ("deduction_homework", -15, "Homework not done · Research salary benchmarks for Junior Dev roles in Miami",
               "advisor", 65, 1, 10, 1),
              ("application", 3, "Applied · React Developer at Nubank", "manual", 68, 1, 18, 15),
              ("application", 3, "Applied · Full Stack Engineer at Microsoft", "extension", 71, 0, 8, 40),
              ("application", 3, "Applied · Frontend Developer at Spotify", "extension", 74, 0, 9, 12)]
    for et, delta, title, src, bal, d, h, m in ledger:
        db.add(PointsEvent(student_id=maria.id, event_type=et, delta=delta, applied_delta=delta, balance_after=bal,
                           title=title, source=src, created_at=_at(d, h, m)))
    db.add(ActivityLog(student_id=maria.id, kind="linkedin_post", post_type="original", occurred_on=local_today() - timedelta(days=8),
                       url="https://www.linkedin.com/posts/example", points_awarded=5))
    db.add(ActivityLog(student_id=maria.id, kind="outreach", contact_name="Laura Pérez", company="Deel",
                       platform="LinkedIn message", occurred_on=local_today() - timedelta(days=7), points_awarded=5))
    s_prev = Session(student_id=maria.id, advisor_id=val.id, session_date=_at(8, 10), session_type="one_on_one",
                     attendance="attended", summary="Mapped target companies and reviewed GitHub.")
    s_ws = Session(student_id=maria.id, advisor_id=val.id, session_date=_at(2, 19), session_type="group_workshop",
                   attendance="absent", title="GeekForce Workshop #9 · Salary negotiation")
    s_last = Session(student_id=maria.id, advisor_id=val.id, session_date=_at(1, 10), session_type="one_on_one",
                     attendance="attended",
                     summary="Reviewed application strategy. Focus on mid-size tech companies in Miami and warm up your "
                             "LinkedIn network before applying. We talked through the Globant offer and salary negotiation.",
                     resources=[{"label": "Negotiation script template", "url": "https://example.com/negotiation"}])
    s_next = Session(student_id=maria.id, advisor_id=val.id, session_date=_at(-5, 10), session_type="one_on_one",
                     attendance="scheduled", title="1:1 meeting")
    db.add_all([s_prev, s_ws, s_last, s_next])
    db.flush()
    db.add(HomeworkTask(session_id=s_prev.id, student_id=maria.id, status="missed",
                        description="Research salary benchmarks for Junior Dev roles in Miami",
                        due_date=local_today() - timedelta(days=1)))
    for desc in ("Send 5 LinkedIn connection requests to engineers at your target companies",
                 "Rewrite your resume summary for React roles using the Resume Builder"):
        db.add(HomeworkTask(session_id=s_last.id, student_id=maria.id, description=desc,
                            due_date=local_today() + timedelta(days=5)))
    for title, body, kind, cat, d in [
        ("You're 6 points from securing your guarantee", "Two applications today gets you back to 80.", "warning", "guarantee", 0),
        ("Valentina added notes and 2 homework tasks", "Due before your next 1:1. +15 each when done.", "info", "advisor", 1),
        ("−15: homework not done before your 1:1", "“Research salary benchmarks” was still pending.", "deduction", "deduction", 1),
        ("−10: GeekForce session missed without notice", "This counts as 1 of your 3 allowed misses.", "deduction", "deduction", 2),
    ]:
        db.add(Notification(user_id=maria.user_id, type=kind, category=cat, title=title, body=body,
                            created_at=_at(d, 9), read=d > 1))

    others = [("Carlos Ruiz", fs, 55, "suspended", 70, dict(missed_meetings=3, consecutive_homework_misses=2, idle=2)),
              ("Ana Torres", ai, 61, "at_risk", 60, dict(idle=25)),
              ("Diego López", ai, 77, "at_risk", 40, {}),
              ("Jorge Medina", fs, 79, "at_risk", 50, dict(missed_meetings=1, idle=1)),
              ("Sofía Ramírez", fs, 84, "secured", 35, {}),
              ("Luis Pereira", ai, 88, "secured", 30, {}),
              ("Kevin Brown", fs, 92, "secured", 25, {})]
    for name, c, pts, status, started, kw in others:
        email = name.split()[0].lower().replace("í", "i").replace("é", "e") + "@geekforce.demo"
        st = student(name, email, c, pts, status, started, **kw)
        db.add(PointsEvent(student_id=st.id, event_type="manual_adjustment", delta=0, applied_delta=0, balance_after=pts,
                           title="Imported balance", source="system", created_at=_at(1, 8)))
    db.commit()
    log.info("Demo data created (password: %s)", DEMO_PASSWORD)
