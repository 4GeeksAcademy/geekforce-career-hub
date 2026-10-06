"""Admin endpoints: rules, users, cohorts, audit log, integration status, scheduled jobs."""
import secrets
from datetime import date

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import hash_password, require_admin, require_staff
from ..config import settings
from ..db import get_db
from ..jobs import JOBS, run_job
from ..models import AuditLog, Cohort, Notification, ResumeVersion, RuleSetting, Student, User
from ..rules import RULES, get_rules, rules_catalog
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
    return [
        {"key": "brevo", "name": "Brevo", "connected": bool(settings.brevo_api_key),
         "detail": f"{emails} emails sent this month" if settings.brevo_api_key else "Add BREVO_API_KEY to send emails"},
        {"key": "claude", "name": "Claude API", "connected": bool(settings.anthropic_api_key),
         "detail": f"{analyses} resume analyses this month" if settings.anthropic_api_key else "Add ANTHROPIC_API_KEY for the resume builder"},
        {"key": "extension", "name": "Chrome extension", "connected": True,
         "detail": "Logs applications from LinkedIn, Indeed, Glassdoor and Greenhouse"},
        {"key": "breathcode", "name": "Breathcode", "connected": settings.breathcode_enabled,
         "detail": "4Geeks login and attendance sync" if settings.breathcode_enabled else
                   "Phase 2. Until then advisors mark attendance here."},
    ]


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
    role: str | None = None
    is_active: bool | None = None
    cohort_id: str | None = None
    advisor_id: str | None = None
    job_search_start_date: date | None = None
    deadline_days: int | None = None
    password: str | None = None


def user_dict(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "is_active": u.is_active,
            "last_login_at": iso(u.last_login_at), "student": student_brief(u.student) if u.student else None,
            "job_search_start_date": u.student.job_search_start_date.isoformat()
            if u.student and u.student.job_search_start_date else None}


@router.get("/users")
def list_users(role: str | None = None, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    q = select(User).order_by(User.name)
    if role:
        q = q.where(User.role.in_(role.split(",")))
    return [user_dict(u) for u in db.scalars(q)]


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


@router.patch("/users/{uid}")
def update_user(uid: str, body: UserPatch, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "Not found")
    data = body.model_dump(exclude_unset=True)
    for k in ("name", "role", "is_active"):
        if k in data:
            setattr(u, k, data[k])
    if "password" in data and data["password"]:
        u.password_hash = hash_password(data["password"])
    if u.student:
        for k in ("cohort_id", "advisor_id", "job_search_start_date", "deadline_days"):
            if k in data:
                setattr(u.student, k, data[k])
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
