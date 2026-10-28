"""Job Radar API: grokbot/partner ingest (secret header) + advisor views."""
import hmac
from datetime import timedelta

from fastapi import APIRouter, Body, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import engine, job_radar as JR
from ..auth import current_user, require_staff, student_for
from ..config import settings
from ..db import get_db
from ..i18n import Cat, M
from ..models import AuditLog, Job, JobShare, Student, User
from ..notify import notify_student, notify_user
from ..serializers import iso
from ..timeutil import now_utc

router = APIRouter(tags=["jobs"])


def job_dict(j: Job, fits: int | None = None) -> dict:
    return {"id": j.id, "source": j.source, "title": j.title, "company": j.company, "location": j.location,
            "work_mode": j.work_mode, "url": j.url, "program": j.program, "posted_at": iso(j.posted_at),
            "found_at": iso(j.created_at), "salary_min": j.salary_min, "salary_max": j.salary_max,
            "contact_name": j.contact_name, "contact_handle": j.contact_handle, "outreach_status": j.outreach_status,
            "is_partner": j.is_partner, "notes": j.notes, "active": j.active, "shared_count": j.shared_count,
            "description": (j.description or "")[:600] or None, "fits": fits}


# ── ingest (grokbot, partners, scripts) ──

@router.post("/integrations/jobs")
def ingest(payload: dict | list = Body(...), x_jobs_secret: str = Header(default=""),
           db: Session = Depends(get_db)):
    """Send one job or many. Body: a job object, a list of jobs, or {"source": "grokbot", "jobs": [...]}.

    Job fields: title (required), company, location, url, description, posted_at (ISO), program
    (full_stack | ai_engineering | data_science | cybersecurity), external_id, contact_name, contact_handle,
    outreach_status (none | contacted | replied | interviewing | closed), work_mode, salary_min, salary_max, notes.
    """
    if not settings.jobs_ingest_secret or not hmac.compare_digest(x_jobs_secret, settings.jobs_ingest_secret):
        raise HTTPException(401, "Bad or missing X-Jobs-Secret")
    source = "grokbot"
    if isinstance(payload, dict) and "jobs" in payload:
        source = str(payload.get("source") or source)
        items = payload["jobs"]
    else:
        items = payload if isinstance(payload, list) else [payload]
    if source not in ("grokbot", "partner", "manual", "adzuna", "x"):
        source = "grokbot"
    if len(items) > 500:
        raise HTTPException(413, "Send at most 500 jobs per request")
    created = updated = 0
    errors = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"#{i}: not an object")
            continue
        try:
            item = {**item, "raw": item}
            _, new = JR.upsert(db, item.pop("source", None) or source, item)
            created += int(new)
            updated += int(not new)
        except ValueError as e:
            errors.append(f"#{i}: {e}")
    db.commit()
    return {"ok": True, "created": created, "updated": updated, "errors": errors[:20]}


# ── advisor views ──

@router.get("/advisor/jobs")
def list_jobs(program: str = "", source: str = "", q: str = "", days: int = 14, outreach: str = "",
              partner: bool = False, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    query = select(Job).where(Job.active.is_(True), Job.created_at >= now_utc() - timedelta(days=max(1, min(days, 365))))
    if program:
        query = query.where(Job.program == program)
    if source:
        query = query.where(Job.source == source)
    if outreach:
        query = query.where(Job.outreach_status == outreach)
    if partner:
        query = query.where(Job.is_partner.is_(True))
    if q:
        like = f"%{q.lower()}%"
        query = query.where(or_(func.lower(Job.title).like(like), func.lower(Job.company).like(like),
                                func.lower(Job.location).like(like)))
    jobs = db.scalars(query.order_by(Job.is_partner.desc(), func.coalesce(Job.posted_at, Job.created_at).desc())
                      .limit(300)).all()
    students = db.scalars(select(Student).where(Student.status == "active")).all()
    by_prog: dict[str | None, int] = {}
    for st in students:
        if st.guarantee_status == "suspended" or st.on_hold or st.stage not in (None, "job_hunting", "interview_prep"):
            continue
        p = JR.student_program(st)
        by_prog[p] = by_prog.get(p, 0) + 1
    total = sum(by_prog.values())
    items = [job_dict(j, by_prog.get(j.program, 0) if j.program else total) for j in jobs]
    sources = dict(db.execute(select(Job.source, func.count()).where(Job.active.is_(True))
                              .group_by(Job.source)).all())
    return {"items": items, "sources": sources, "programs": JR.PROGRAMS,
            "adzuna_connected": bool(settings.adzuna_app_id and settings.adzuna_app_key),
            "ingest_ready": bool(settings.jobs_ingest_secret)}


class JobIn(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    company: str | None = None
    location: str | None = None
    url: str | None = None
    program: str | None = None
    description: str | None = None
    is_partner: bool = False
    contact_name: str | None = None
    contact_handle: str | None = None
    notes: str | None = None


@router.post("/advisor/jobs")
def add_job(body: JobIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    job, _ = JR.upsert(db, "partner" if body.is_partner else "manual", body.model_dump())
    db.commit()
    return job_dict(job)


class JobPatch(BaseModel):
    outreach_status: str | None = Field(default=None, pattern="^(none|contacted|replied|interviewing|closed)$")
    notes: str | None = None
    is_partner: bool | None = None
    active: bool | None = None
    program: str | None = None


@router.patch("/advisor/jobs/{job_id}")
def patch_job(job_id: str, body: JobPatch, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(job, k, v)
    db.commit()
    return job_dict(job)


@router.get("/advisor/jobs/{job_id}/fits")
def job_fits(job_id: str, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    out = []
    for st in JR.candidates(db, job, limit=30):
        out.append({"id": st.id, "name": st.user.name, "initials": "".join(p[0] for p in st.user.name.split()[:2]).upper(),
                    "cohort": st.cohort.name if st.cohort else None, "points": st.career_points,
                    "guarantee_status": st.guarantee_status, "stage": st.stage,
                    "mine": st.advisor_id == user.id})
    return {"job": job_dict(job), "students": out}


class ShareIn(BaseModel):
    student_ids: list[str] = Field(default_factory=list, max_length=500)
    cohort_id: str | None = None          # share with a whole group instead of (or as well as) picked students
    program: str | None = None
    stage: str | None = None
    note: str | None = Field(default=None, max_length=1000)


def _share_targets(db: Session, user: User, body: ShareIn) -> list[Student]:
    """Picked students plus everyone in the chosen group; advisors reach only their own students, admins everyone."""
    q = select(Student).join(User, Student.user_id == User.id).where(User.is_active.is_(True), Student.status == "active")
    if user.role != "admin":
        q = q.where(Student.advisor_id == user.id)
    picked = []
    if body.student_ids:
        picked = list(db.scalars(q.where(Student.id.in_(body.student_ids))).all())
    group = []
    if body.cohort_id or body.program or body.stage:
        gq = q
        if body.cohort_id:
            gq = gq.where(Student.cohort_id == body.cohort_id)
        if body.stage:
            gq = gq.where(func.coalesce(Student.stage, "not_started") == body.stage)
        group = list(db.scalars(gq).all())
        if body.program:
            group = [s for s in group if JR.student_program(s) == body.program]
    seen, out = set(), []
    for s in picked + group:
        if s.id not in seen:
            seen.add(s.id)
            out.append(s)
    return out


@router.post("/advisor/jobs/{job_id}/share")
def share_job(job_id: str, body: ShareIn, dry_run: bool = False, user: User = Depends(require_staff),
              db: Session = Depends(get_db)):
    """Share a job in the app: each student gets it in "Jobs for you" plus a notification (and email)."""
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    targets = _share_targets(db, user, body)
    already = set(db.scalars(select(JobShare.student_id).where(JobShare.job_id == job.id)).all())
    new = [s for s in targets if s.id not in already]
    if dry_run:
        return {"would_share": len(new), "already": len(targets) - len(new)}
    if not targets:
        raise HTTPException(422, "Pick at least one student or a group.")
    first = user.name.split()[0]
    for st in new:
        db.add(JobShare(job_id=job.id, student_id=st.id, shared_by=user.id, note=(body.note or "").strip() or None))
        where = M(" at {company}", company=job.company) if job.company else ""
        notify_student(db, st, type="info", category="advisor", pref_key="job_match",
                       title=M("{name} shared a job with you: {title}{where}", name=first, title=job.title, where=where),
                       body=Cat((body.note or "").strip(), M("See it in Jobs for you, and tell {name} if you apply or if it's not a fit.", name=first)),
                       link="/jobs")
    job.shared_count = len(already) + len(new)
    db.add(AuditLog(actor_id=user.id, action="job_shared", detail=f"{job.title} · {len(new)} student(s)",
                    data={"job_id": job.id, "students": [s.id for s in new], "cohort_id": body.cohort_id,
                          "program": body.program, "stage": body.stage}))
    db.commit()
    return {"ok": True, "shared": len(new), "already": len(targets) - len(new)}


@router.get("/advisor/jobs/{job_id}/shares")
def job_shares(job_id: str, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    rows = db.scalars(select(JobShare).where(JobShare.job_id == job_id).order_by(JobShare.created_at.desc())).all()
    out = []
    for r in rows:
        st = db.get(Student, r.student_id)
        if user.role != "admin" and st.advisor_id != user.id:
            continue
        out.append({"id": r.id, "student_id": st.id, "name": st.user.name, "cohort": st.cohort.name if st.cohort else None,
                    "status": r.status, "response_note": r.response_note, "seen": r.seen_at is not None,
                    "shared_at": iso(r.created_at), "responded_at": iso(r.responded_at)})
    return out


# ── students: "Jobs for you" ──

def share_dict(r: JobShare, db: Session) -> dict:
    by = db.get(User, r.shared_by) if r.shared_by else None
    return {"id": r.id, "status": r.status, "note": r.note, "response_note": r.response_note, "shared_at": iso(r.created_at),
            "new": r.seen_at is None, "shared_by": by.name if by else None, "application_id": r.application_id,
            "job": job_dict(r.job)}


@router.get("/students/{student_id}/jobs")
def my_jobs(student_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    rows = db.scalars(select(JobShare).where(JobShare.student_id == st.id).order_by(JobShare.created_at.desc())).all()
    out = [share_dict(r, db) for r in rows]
    if user.role == "student":
        for r in rows:
            r.seen_at = r.seen_at or now_utc()
        db.commit()
    return out


@router.get("/students/me/jobs/unseen")
def unseen_jobs(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not user.student:
        return {"count": 0}
    return {"count": db.scalar(select(func.count(JobShare.id)).where(JobShare.student_id == user.student.id,
                                                                   JobShare.seen_at.is_(None))) or 0}


class ShareResponseIn(BaseModel):
    status: str = Field(pattern="^(new|interested|applied|not_a_fit)$")
    note: str | None = Field(default=None, max_length=500)


@router.patch("/students/{student_id}/jobs/{share_id}")
def respond_job(student_id: str, share_id: str, body: ShareResponseIn, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    """Interested / applied / not a fit. 'Applied' logs the application in the tracker (+points) once."""
    st = student_for(db, user, student_id)
    r = db.get(JobShare, share_id)
    if not r or r.student_id != st.id:
        raise HTTPException(404, "Job not found")
    r.status, r.response_note, r.responded_at = body.status, (body.note or "").strip() or None, now_utc()
    created = False
    if body.status == "applied" and not r.application_id:
        app, created = engine.record_application(db, st, company=r.job.company or "—", role=r.job.title,
                                                 job_url=r.job.url, source="job_radar",
                                                 notes="Shared by your advisor (Job Radar)", user=user)
        r.application_id = app.id
    if body.status in ("applied", "not_a_fit") and st.advisor and user.role == "student":
        what = M("applied to") if body.status == "applied" else M("passed on")
        notify_user(db, st.advisor, type="info", category="advisor_alert", pref_key="guarantee", email=False,
                    title=M("{name} {what} {title}", name=st.user.name, what=what, title=r.job.title),
                    body=r.response_note or "", link="/staff/jobs")
    db.commit()
    return {**share_dict(r, db), "logged_application": created, "points": st.career_points}

