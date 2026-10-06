"""Advisor endpoints (advisors see their own students; admins see everyone)."""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import engine
from ..auth import require_staff, student_for
from ..db import get_db
from ..jobs import _last_activity
from ..models import Application, Cohort, HomeworkTask, PauseRequest, Session as SessionModel, Student, User
from ..rules import get_rules
from ..serializers import homework_dict, pause_dict, session_dict, student_brief
from ..timeutil import local_today, now_utc, week_start

router = APIRouter(prefix="/advisor", tags=["advisor"])


def _scope(user: User):
    q = select(Student).join(User, Student.user_id == User.id).where(User.is_active.is_(True))
    if user.role != "admin":
        q = q.where(Student.advisor_id == user.id)
    return q


def _row(db: Session, st: Student, monday: date, today: date) -> dict:
    last = _last_activity(db, st)
    nxt = db.scalar(select(func.min(SessionModel.session_date)).where(
        SessionModel.student_id == st.id, SessionModel.attendance == "scheduled",
        SessionModel.session_date >= now_utc()))
    return {**student_brief(st), "apps_this_week": engine.applications_in_week(db, st.id, monday),
            "missed_meetings": st.missed_meetings, "homework_streak": st.consecutive_homework_misses,
            "last_active": last.isoformat() if last else None,
            "idle_days": (today - last).days if last else None,
            "next_session": nxt.isoformat() if nxt else None}


ORDER = {"suspended": 0, "at_risk": 1, "secured": 3, "not_eligible": 4}


@router.get("/students")
def my_students(cohort_id: str | None = None, status: str | None = None, q: str | None = None,
                user: User = Depends(require_staff), db: Session = Depends(get_db)):
    r = get_rules(db)
    query = _scope(user)
    if cohort_id:
        query = query.where(Student.cohort_id == cohort_id)
    students = db.scalars(query).all()
    monday, today = week_start(), local_today()
    rows = [_row(db, st, monday, today) for st in students]
    if q:
        rows = [x for x in rows if q.lower() in x["name"].lower() or q.lower() in x["email"].lower()]
    if status:
        rows = [x for x in rows if (x["status"] == status or x["guarantee_status"] == status or
                                    (status == "paused" and x["paused"]))]
    rows.sort(key=lambda x: (x["status"] != "active", ORDER.get(x["guarantee_status"], 5) if not x["paused"] else 2,
                             x["points"]))
    active = [x for x in rows if x["status"] == "active"]
    summary = {"students": len(rows),
               "secured": sum(1 for x in active if x["guarantee_status"] == "secured" and not x["paused"]),
               "at_risk": sum(1 for x in active if x["guarantee_status"] == "at_risk" and not x["paused"]),
               "suspended": sum(1 for x in active if x["guarantee_status"] == "suspended" and not x["paused"]),
               "paused": sum(1 for x in active if x["paused"]),
               "hired": sum(1 for x in rows if x["status"] == "hired")}
    cohorts = db.scalars(select(Cohort).order_by(Cohort.name)).all()
    return {"summary": summary, "items": rows, "target": r.weekly_application_target,
            "max_missed": r.max_missed_meetings,
            "cohorts": [{"id": c.id, "name": c.name} for c in cohorts]}


@router.get("/attention")
def attention(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    r = get_rules(db)
    today = local_today()
    items = []
    for st in db.scalars(_scope(user).where(Student.status == "active")).all():
        name = st.user.name
        if st.guarantee_status == "suspended" and not engine.is_paused(st):
            items.append({"kind": "suspended", "student_id": st.id, "text":
                          f"{name} is at {st.career_points} points. Guarantee suspended."})
        last = _last_activity(db, st)
        if last and (today - last).days >= r.inactivity_warning_day and not engine.is_paused(st):
            d = (today - last).days
            items.append({"kind": "inactive", "student_id": st.id, "text":
                          f"{name} has been inactive for {d} days." +
                          (f" Deduction fires on day {r.inactivity_days + 1}." if d <= r.inactivity_days else "")})
        if st.missed_meetings >= r.max_missed_meetings:
            items.append({"kind": "meetings", "student_id": st.id,
                          "text": f"{name} reached {st.missed_meetings} missed meetings. Review the guarantee."})
        for a in db.scalars(select(Application).where(Application.student_id == st.id, Application.status == "offer")):
            items.append({"kind": "offer", "student_id": st.id,
                          "text": f"{name} has an open offer from {a.company}. Rejecting without justification is "
                                  f"−{abs(r.ded_offer_rejected)}."})
    for pr in db.scalars(select(PauseRequest).where(PauseRequest.status == "pending")).all():
        st = db.get(Student, pr.student_id)
        if user.role == "admin" or st.advisor_id == user.id:
            items.append({"kind": "pause", "student_id": st.id, "pause_id": pr.id,
                          "text": f"{st.user.name} requested a {(pr.end_date - pr.start_date).days + 1}-day pause "
                                  f"({pr.reason_type})."})
    rank = {"suspended": 0, "meetings": 1, "inactive": 2, "offer": 3, "pause": 4}
    items.sort(key=lambda x: rank[x["kind"]])
    return items


# ── sessions ──

class HomeworkIn(BaseModel):
    description: str = Field(min_length=3)
    due_date: date | None = None
    point_value: int | None = None


class SessionIn(BaseModel):
    student_id: str
    session_date: datetime
    session_type: str = Field(pattern="^(one_on_one|group_workshop|mock_interview)$")
    attendance: str = Field(pattern="^(attended|excused|absent)$")
    title: str | None = None
    summary: str | None = None
    resources: list[dict] = []
    homework: list[HomeworkIn] = []
    completed_task_ids: list[str] = []
    scheduled_session_id: str | None = None


class ScheduleIn(BaseModel):
    student_id: str
    session_date: datetime
    session_type: str = Field(pattern="^(one_on_one|group_workshop|mock_interview)$")
    title: str | None = None


def _plan_dict(plan: engine.SessionPlan) -> dict:
    return {"effects": [{"type": e.event_type, "delta": e.delta, "title": e.title} for e in plan.effects],
            "missed_tasks": [homework_dict(t) for t in plan.missed_tasks],
            "streak_after": plan.streak_after, "missed_meetings_after": plan.missed_meetings_after,
            "balance_before": plan.balance_before, "balance_after": plan.balance_after,
            "status_after": plan.status_after, "notes": plan.notes}


@router.post("/sessions/preview")
def preview_session(body: SessionIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    st = student_for(db, user, body.student_id)
    # Simulate verified completions: they add points before the homework check.
    extra = sum(t.point_value for t in (db.get(HomeworkTask, i) for i in body.completed_task_ids)
                if t and t.student_id == st.id and t.status == "pending")
    plan = engine.plan_session(db, st, session_type=body.session_type, attendance=body.attendance,
                               session_date=body.session_date, completed_task_ids=set(body.completed_task_ids))
    d = _plan_dict(plan)
    if extra:
        r = get_rules(db)
        d["effects"].insert(0, {"type": "homework", "delta": extra, "title": "Homework confirmed done"})
        bal = max(r.points_floor, min(r.points_ceiling, st.career_points + extra))
        for e in plan.effects:
            bal = max(r.points_floor, min(r.points_ceiling, bal + e.delta))
        d["balance_after"] = bal
        d["status_after"] = engine.compute_status(bal, r)
    d["emails"] = ["Notes and homework to the student"] if (body.summary or body.homework) else []
    return d


@router.post("/sessions", status_code=201)
def create_session(body: SessionIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    st = student_for(db, user, body.student_id)
    if body.scheduled_session_id:
        sch = db.get(SessionModel, body.scheduled_session_id)
        if sch and sch.student_id == st.id and sch.attendance == "scheduled":
            db.delete(sch)
            db.flush()
    sess, plan = engine.log_session(
        db, st, user, session_type=body.session_type, attendance=body.attendance, session_date=body.session_date,
        title=body.title, summary=body.summary, resources=body.resources,
        new_homework=[h.model_dump() for h in body.homework], completed_task_ids=set(body.completed_task_ids))
    db.commit()
    return {"session": session_dict(sess, db), "result": _plan_dict(plan), "points": st.career_points,
            "status": st.guarantee_status}


@router.post("/sessions/schedule", status_code=201)
def schedule_session(body: ScheduleIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    st = student_for(db, user, body.student_id)
    s = SessionModel(student_id=st.id, advisor_id=user.id, session_date=body.session_date,
                     session_type=body.session_type, attendance="scheduled", title=body.title)
    db.add(s)
    from ..notify import notify_student
    notify_student(db, st, type="info", category="session", pref_key="session_scheduled",
                   title=f"New session with {user.name}",
                   body=f"{body.title or 'Session'} on {body.session_date:%A, %b %d at %I:%M %p}.", link="/advisor")
    engine.touch(st)
    db.commit()
    return session_dict(s)


@router.patch("/homework/{task_id}/verify")
def verify_homework(task_id: str, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    t = db.get(HomeworkTask, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    student_for(db, user, t.student_id)
    t.verified_by_advisor = True
    db.commit()
    return homework_dict(t)


# ── points actions ──

class ManualIn(BaseModel):
    student_id: str
    delta: int = Field(ge=-100, le=100)
    reason: str


class OfferIn(BaseModel):
    student_id: str
    company: str
    application_id: str | None = None
    justification: str | None = None
    justification_approved: bool = False


class ProjectIn(BaseModel):
    student_id: str
    title: str


@router.post("/points/manual")
def manual(body: ManualIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    st = student_for(db, user, body.student_id)
    engine.manual_adjustment(db, st, user, body.delta, body.reason)
    db.commit()
    return {"points": st.career_points, "status": st.guarantee_status}


@router.post("/offer-rejection")
def offer(body: OfferIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    st = student_for(db, user, body.student_id)
    engine.report_offer_rejection(db, st, user, company=body.company, application_id=body.application_id,
                                  justification=body.justification, approved=body.justification_approved)
    db.commit()
    return {"points": st.career_points, "status": st.guarantee_status}


@router.post("/project")
def project(body: ProjectIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    st = student_for(db, user, body.student_id)
    engine.project_submitted(db, st, user, body.title)
    db.commit()
    return {"points": st.career_points}


class StudentStatusIn(BaseModel):
    status: str = Field(pattern="^(active|hired|withdrawn)$")


@router.patch("/students/{student_id}/status")
def set_status(student_id: str, body: StudentStatusIn, user: User = Depends(require_staff),
               db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    st.status = body.status
    from ..models import AuditLog
    db.add(AuditLog(actor_id=user.id, student_id=st.id, action="student_status", detail=f"Status → {body.status}"))
    db.commit()
    return student_brief(st)


# ── pauses ──

@router.get("/pauses")
def list_pauses(status: str = "pending", user: User = Depends(require_staff), db: Session = Depends(get_db)):
    rows = db.scalars(select(PauseRequest).where(PauseRequest.status.in_(status.split(",")))
                      .order_by(PauseRequest.created_at)).all()
    out = []
    for p in rows:
        st = db.get(Student, p.student_id)
        if user.role == "admin" or st.advisor_id == user.id:
            out.append(pause_dict(p, st, db))
    return out


class DecisionIn(BaseModel):
    note: str | None = None


@router.post("/pauses/{pid}/approve")
def approve(pid: str, body: DecisionIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    pr = db.get(PauseRequest, pid)
    if not pr:
        raise HTTPException(404, "Not found")
    student_for(db, user, pr.student_id)
    engine.decide_pause(db, pr, user, True, body.note)
    db.commit()
    return {"ok": True}


@router.post("/pauses/{pid}/decline")
def decline(pid: str, body: DecisionIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    pr = db.get(PauseRequest, pid)
    if not pr:
        raise HTTPException(404, "Not found")
    student_for(db, user, pr.student_id)
    engine.decide_pause(db, pr, user, False, body.note)
    db.commit()
    return {"ok": True}
