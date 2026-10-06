"""Student-facing endpoints. `student_id` can be "me" or an id the caller may view (advisor/admin)."""
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import engine
from ..auth import current_user, student_for
from ..db import get_db
from ..models import (
    ActivityLog, Application, HomeworkTask, Notification, NotificationPreference, PauseRequest, PointsEvent,
    ProfileTask, ResumeVersion, Session as SessionModel, User,
)
from ..notify import LOCKED, OPTIONAL
from ..rules import get_rules
from ..serializers import (
    activity_dict, application_dict, dashboard, event_dict, guarantee_conditions, homework_dict, iso,
    notification_dict, pause_dict, session_dict,
)
from ..services import resume as resume_svc
from ..timeutil import local_today, week_bounds_utc, week_start

router = APIRouter(tags=["student"])

APP_STATUSES = {"applied", "phone_screen", "technical", "final", "offer", "rejected", "withdrawn"}
SOURCES = {"extension_linkedin", "extension_indeed", "extension_glassdoor", "extension_greenhouse",
           "extension_lever", "manual"}


@router.get("/students/{student_id}/dashboard")
def get_dashboard(student_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return dashboard(db, student_for(db, user, student_id))


@router.get("/students/{student_id}/guarantee")
def get_guarantee(student_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    r = get_rules(db)
    return {"status": st.guarantee_status, "points": st.career_points,
            "conditions": guarantee_conditions(db, st, r)}


@router.get("/students/{student_id}/points")
def get_points(student_id: str, limit: int = Query(100, le=1000), user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    evs = db.scalars(select(PointsEvent).where(PointsEvent.student_id == st.id)
                     .order_by(PointsEvent.created_at.desc()).limit(limit)).all()
    return {"points": st.career_points, "status": st.guarantee_status, "events": [event_dict(e) for e in evs]}


# ── applications ──

class ApplicationIn(BaseModel):
    company: str = Field(min_length=1, max_length=255)
    role: str = Field(min_length=1, max_length=255)
    job_url: str | None = None
    source: str = "manual"
    notes: str | None = None
    student_id: str = "me"


class ApplicationPatch(BaseModel):
    status: str | None = None
    notes: str | None = None
    followup_date: date | None = None
    company: str | None = None
    role: str | None = None


@router.get("/students/{student_id}/applications")
def list_applications(student_id: str, status: str | None = None, q: str | None = None,
                      user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    query = select(Application).where(Application.student_id == st.id)
    if status:
        query = query.where(Application.status.in_(status.split(",")))
    if q:
        like = f"%{q.lower()}%"
        query = query.where(func.lower(Application.company).like(like) | func.lower(Application.role).like(like))
    apps = db.scalars(query.order_by(Application.applied_at.desc())).all()
    counts = dict(db.execute(select(Application.status, func.count()).where(Application.student_id == st.id)
                             .group_by(Application.status)).all())
    total = sum(counts.values())
    return {"items": [application_dict(a) for a in apps], "counts": counts, "total": total,
            "this_week": engine.applications_in_week(db, st.id, week_start()),
            "target": get_rules(db).weekly_application_target}


@router.post("/applications", status_code=201)
def create_application(body: ApplicationIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, body.student_id)
    if body.source not in SOURCES:
        raise HTTPException(422, "Unknown source")
    app, created = engine.record_application(db, st, company=body.company, role=body.role, job_url=body.job_url,
                                             source=body.source, notes=body.notes, user=user)
    db.commit()
    return {"application": application_dict(app), "created": created, "points": st.career_points,
            "this_week": engine.applications_in_week(db, st.id, week_start()),
            "target": get_rules(db).weekly_application_target}


@router.patch("/applications/{app_id}")
def update_application(app_id: str, body: ApplicationPatch, user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    app = db.get(Application, app_id)
    if not app:
        raise HTTPException(404, "Application not found")
    student_for(db, user, app.student_id)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in APP_STATUSES:
        raise HTTPException(422, "Unknown status")
    for k, v in data.items():
        setattr(app, k, v)
    db.commit()
    return application_dict(app)


@router.delete("/applications/{app_id}")
def delete_application(app_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    app = db.get(Application, app_id)
    if not app:
        raise HTTPException(404, "Application not found")
    st = student_for(db, user, app.student_id)
    engine.undo_application(db, st, app, user)
    db.commit()
    return {"ok": True, "points": st.career_points}


# ── activity logs (outreach, LinkedIn, networking) ──

class ActivityIn(BaseModel):
    kind: str
    contact_name: str | None = None
    company: str | None = None
    platform: str | None = None
    url: str | None = None
    post_type: str | None = None
    notes: str | None = None
    occurred_on: date | None = None
    student_id: str = "me"


@router.get("/students/{student_id}/activities")
def list_activities(student_id: str, kind: str | None = None, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    q = select(ActivityLog).where(ActivityLog.student_id == st.id)
    if kind:
        q = q.where(ActivityLog.kind == kind)
    items = db.scalars(q.order_by(ActivityLog.occurred_on.desc(), ActivityLog.created_at.desc())).all()
    counts = dict(db.execute(select(ActivityLog.kind, func.count()).where(ActivityLog.student_id == st.id)
                             .group_by(ActivityLog.kind)).all())
    monday = week_start()
    r = get_rules(db)
    return {"items": [activity_dict(a) for a in items], "counts": counts,
            "week": {"outreach": engine.activities_in_week(db, st.id, "outreach", monday, True),
                     "outreach_cap": r.cap_outreach_week,
                     "linkedin": engine.activities_in_week(db, st.id, "linkedin_post", monday, True),
                     "linkedin_cap": r.cap_linkedin_posts_week}}


@router.post("/activities", status_code=201)
def create_activity(body: ActivityIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, body.student_id)
    occurred = body.occurred_on or local_today()
    if occurred > local_today():
        raise HTTPException(422, "The date can't be in the future")
    fields = body.model_dump(exclude={"kind", "occurred_on", "student_id"})
    act = engine.log_activity(db, st, kind=body.kind, user=user, occurred_on=occurred, **fields)
    db.commit()
    return {"activity": activity_dict(act), "points": st.career_points}


# ── profile tasks ──

@router.get("/students/{student_id}/profile-tasks")
def list_profile_tasks(student_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    done = {p.task: iso(p.completed_at) for p in db.scalars(select(ProfileTask).where(ProfileTask.student_id == st.id))}
    return [{"task": t, "done": t in done, "completed_at": done.get(t)} for t in ("cv", "github", "linkedin", "headshot")]


@router.post("/students/me/profile-tasks/{task}")
def complete_profile_task(task: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, "me")
    created = engine.complete_profile_task(db, st, task, user)
    db.commit()
    return {"created": created, "points": st.career_points}


# ── sessions & homework ──

@router.get("/students/{student_id}/sessions")
def list_sessions(student_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    rows = db.scalars(select(SessionModel).where(SessionModel.student_id == st.id)
                      .order_by(SessionModel.session_date.desc())).all()
    return [session_dict(s, db) for s in rows]


@router.patch("/homework/{task_id}/complete")
def complete_homework(task_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = db.get(HomeworkTask, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    st = student_for(db, user, t.student_id)
    engine.complete_homework(db, st, t, user)
    db.commit()
    return {"task": homework_dict(t), "points": st.career_points}


# ── notifications ──

@router.get("/notifications")
def list_notifications(unread: bool = False, category: str | None = None, user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    q = select(Notification).where(Notification.user_id == user.id)
    if unread:
        q = q.where(Notification.read.is_(False))
    if category:
        q = q.where(Notification.category.in_(category.split(",")))
    items = db.scalars(q.order_by(Notification.created_at.desc()).limit(100)).all()
    n_unread = db.scalar(select(func.count(Notification.id)).where(
        Notification.user_id == user.id, Notification.read.is_(False))) or 0
    return {"items": [notification_dict(n) for n in items], "unread": n_unread}


@router.patch("/notifications/{nid}/read")
def read_notification(nid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.get(Notification, nid)
    if not n or n.user_id != user.id:
        raise HTTPException(404, "Not found")
    n.read = True
    db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def read_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    for n in db.scalars(select(Notification).where(Notification.user_id == user.id, Notification.read.is_(False))):
        n.read = True
    db.commit()
    return {"ok": True}


@router.get("/notifications/preferences")
def get_preferences(user: User = Depends(current_user), db: Session = Depends(get_db)):
    prefs = {p.key: p.enabled for p in db.scalars(select(NotificationPreference).where(
        NotificationPreference.user_id == user.id))}
    return {"locked": [{"key": k, "label": v} for k, v in LOCKED.items()],
            "optional": [{"key": k, "label": v, "enabled": prefs.get(k, True)} for k, v in OPTIONAL.items()]}


class PrefIn(BaseModel):
    key: str
    enabled: bool


@router.put("/notifications/preferences")
def set_preference(body: PrefIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.key not in OPTIONAL:
        raise HTTPException(400, "This notification can't be turned off")
    p = db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user.id,
                                                       NotificationPreference.key == body.key))
    if not p:
        p = NotificationPreference(user_id=user.id, key=body.key)
        db.add(p)
    p.enabled = body.enabled
    db.commit()
    return {"ok": True}


# ── pauses ──

class PauseIn(BaseModel):
    start_date: date
    end_date: date
    reason_type: str = Field(pattern="^(medical|family|travel|other)$")
    reason: str | None = None


@router.post("/pauses", status_code=201)
def request_pause(body: PauseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, "me")
    pr = engine.request_pause(db, st, start_date=body.start_date, end_date=body.end_date,
                              reason_type=body.reason_type, reason=body.reason)
    db.commit()
    return pause_dict(pr, st, db)


@router.get("/students/{student_id}/pauses")
def student_pauses(student_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    rows = db.scalars(select(PauseRequest).where(PauseRequest.student_id == st.id)
                      .order_by(PauseRequest.created_at.desc())).all()
    return [pause_dict(p, st, db) for p in rows]


# ── resume builder ──

@router.post("/resume/analyze")
async def analyze_resume(job_description: str = Form(...), title: str = Form(""), resume_text: str = Form(""),
                         file: UploadFile | None = File(None), user: User = Depends(current_user),
                         db: Session = Depends(get_db)):
    st = student_for(db, user, "me")
    text = resume_text.strip()
    if file is not None and file.filename:
        data = await file.read()
        if len(data) > 5 * 1024 * 1024:
            raise HTTPException(413, "Keep the file under 5 MB")
        text = resume_svc.extract_text(file.filename, data)
        engine.complete_profile_task(db, st, "cv", user)
    if not text:
        last = db.scalar(select(ResumeVersion).where(ResumeVersion.student_id == st.id)
                         .order_by(ResumeVersion.created_at.desc()))
        if not last:
            raise HTTPException(422, "Upload your resume or paste it as text")
        text = last.resume_text
    analysis = resume_svc.analyze(text, job_description)
    v = ResumeVersion(student_id=st.id, title=title.strip() or "Tailored resume", resume_text=text,
                      job_description=job_description, analysis=analysis)
    db.add(v)
    engine.touch(st)
    db.commit()
    return {"id": v.id, "title": v.title, "analysis": analysis, "created_at": iso(v.created_at)}


@router.get("/resume/versions")
def resume_versions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, "me")
    rows = db.scalars(select(ResumeVersion).where(ResumeVersion.student_id == st.id)
                      .order_by(ResumeVersion.created_at.desc())).all()
    return [{"id": v.id, "title": v.title, "score": (v.analysis or {}).get("tailoring_score"),
             "projected": (v.analysis or {}).get("projected_score"), "created_at": iso(v.created_at),
             "analysis": v.analysis, "job_description": v.job_description} for v in rows]


@router.get("/resume/versions/{vid}/docx")
def download_resume(vid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, "me")
    v = db.get(ResumeVersion, vid)
    if not v or v.student_id != st.id:
        raise HTTPException(404, "Not found")
    r = get_rules(db)
    if not v.downloaded and r.pts_resume_download:
        start, _ = week_bounds_utc(week_start())
        n = db.scalar(select(func.count(PointsEvent.id)).where(
            PointsEvent.student_id == st.id, PointsEvent.event_type == "resume",
            PointsEvent.created_at >= start)) or 0
        if n < r.cap_resume_downloads_week:
            engine.award(db, st, "resume", r.pts_resume_download, f"Tailored resume · {v.title}",
                         source="manual", source_id=v.id, key=f"resume:{v.id}")
    v.downloaded = True
    db.commit()
    data = resume_svc.build_docx(v.analysis)
    safe = "".join(c for c in v.title if c.isalnum() or c in " -_").strip().replace(" ", "_") or "resume"
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.docx"'})
