"""The Career Points engine — every earn/deduct rule from the Career Points Policy lives here.

All changes to a student's balance go through `award()`, which:
  * is idempotent when given a key (cron jobs can safely re-run),
  * freezes automatic deductions during an approved pause,
  * clamps to the floor/ceiling,
  * writes an auditable PointsEvent with balance_after,
  * recomputes the guarantee status and fires notifications on threshold crossings.
"""
import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

from .models import (
    ActivityLog, Application, AuditLog, HomeworkTask, OfferReport, PauseRequest, PointsEvent, ProfileTask,
    Session, Student, User,
)
from .notify import alert_advisor, notify_student
from .rules import Rules, get_rules
from .timeutil import aware, local_today, now_utc, tz, week_bounds_utc, week_start

# Automatic deductions are frozen while a pause is approved and active.
AUTO_DEDUCTIONS = {
    "deduction_weekly", "deduction_homework", "deduction_streak", "deduction_linkedin",
    "deduction_outreach", "deduction_inactivity", "deduction_absence",
}

STATUS_LABEL = {"secured": "Secured", "at_risk": "At risk", "suspended": "Suspended"}


# ───────────────────────── status ─────────────────────────

def is_paused(st: Student, today: date | None = None) -> bool:
    today = today or local_today()
    return bool(st.paused_from and st.paused_until and st.paused_from <= today <= st.paused_until)


def compute_status(points: int, r: Rules) -> str:
    if points >= r.secured_threshold:
        return "secured"
    if points >= r.suspended_below:
        return "at_risk"
    return "suspended"


def refresh_status(db: DB, st: Student, r: Rules | None = None) -> str:
    r = r or get_rules(db)
    if st.status != "active" or st.guarantee_status == "not_eligible" or is_paused(st):
        return st.guarantee_status  # frozen
    new, old = compute_status(st.career_points, r), st.guarantee_status
    if new == old:
        return new
    st.guarantee_status = new
    gap = r.secured_threshold - st.career_points
    if new == "at_risk" and old == "secured":
        notify_student(db, st, type="warning", category="guarantee",
                       title="Your Job Guarantee is at risk",
                       body=f"You're at {st.career_points} points, {gap} below {r.secured_threshold}. "
                            f"Stay above {r.suspended_below} to avoid suspension.",
                       link="/points")
    elif new == "suspended":
        notify_student(db, st, type="critical", category="guarantee",
                       title="Your Job Guarantee is suspended",
                       body=f"Your balance dropped to {st.career_points}, below {r.suspended_below}. "
                            f"Get back to {r.secured_threshold} to restore it. Your advisor has been notified.",
                       link="/points")
        alert_advisor(db, st, f"{st.user.name}: guarantee suspended",
                      f"{st.user.name} dropped to {st.career_points} points.")
    elif new == "secured":
        notify_student(db, st, type="success", category="guarantee",
                       title="Your Job Guarantee is secured again",
                       body=f"You're back at {st.career_points} points. Keep it up.", link="/points")
    elif new == "at_risk" and old == "suspended":
        notify_student(db, st, type="warning", category="guarantee",
                       title="Out of suspension, still at risk",
                       body=f"You're at {st.career_points}. {gap} more points secures your guarantee.",
                       link="/points")
    return new


def award(db: DB, st: Student, event_type: str, delta: int, title: str, *, source: str = "system",
          source_id: str | None = None, note: str | None = None, created_by: str | None = None,
          key: str | None = None, r: Rules | None = None, at: datetime | None = None) -> PointsEvent | None:
    if delta == 0 and event_type != "manual_adjustment":
        return None
    if key and db.scalar(select(PointsEvent.id).where(PointsEvent.idempotency_key == key)):
        return None
    r = r or get_rules(db)
    if delta < 0 and event_type in AUTO_DEDUCTIONS and is_paused(st):
        return None
    before = st.career_points
    after = max(r.points_floor, min(r.points_ceiling, before + delta))
    ev = PointsEvent(student_id=st.id, event_type=event_type, delta=delta, applied_delta=after - before,
                     balance_after=after, title=title, source=source, source_id=source_id, note=note,
                     created_by=created_by, idempotency_key=key)
    if at:
        ev.created_at = at
    st.career_points = after
    db.add(ev)
    db.flush()
    refresh_status(db, st, r)
    return ev


def touch(st: Student):
    st.last_activity_at = now_utc()


# ───────────────────────── counters ─────────────────────────

def applications_in_week(db: DB, student_id: str, monday: date) -> int:
    start, end = week_bounds_utc(monday)
    return db.scalar(select(func.count(Application.id)).where(
        Application.student_id == student_id, Application.applied_at >= start, Application.applied_at < end)) or 0


def activities_in_week(db: DB, student_id: str, kind: str, monday: date, awarded_only=False) -> int:
    q = select(func.count(ActivityLog.id)).where(
        ActivityLog.student_id == student_id, ActivityLog.kind == kind,
        ActivityLog.occurred_on >= monday, ActivityLog.occurred_on < monday + timedelta(days=7))
    if awarded_only:
        q = q.where(ActivityLog.points_awarded > 0)
    return db.scalar(q) or 0


def deadline_info(db: DB, st: Student, r: Rules | None = None) -> dict:
    r = r or get_rules(db)
    base = st.deadline_days or (st.cohort.deadline_days if st.cohort else None) or r.default_deadline_days
    total = base + (st.deadline_extension_days or 0)
    start = st.job_search_start_date
    today = local_today()
    return {
        "base_days": base, "extension_days": st.deadline_extension_days or 0, "total_days": total,
        "day": (today - start).days + 1 if start else None,
        "deadline": (start + timedelta(days=total)).isoformat() if start else None,
    }


# ───────────────────────── applications & activity ─────────────────────────

def record_application(db: DB, st: Student, *, company: str, role: str, job_url: str | None,
                       source: str, notes: str | None, user: User) -> tuple[Application, bool]:
    """Returns (application, created). Duplicate submits of the same job within 24h are ignored
    (the extension can fire twice on multi-step apply flows)."""
    if job_url:
        dup = db.scalar(select(Application).where(
            Application.student_id == st.id, Application.job_url == job_url,
            Application.applied_at >= now_utc() - timedelta(hours=24)))
        if dup:
            return dup, False
    r = get_rules(db)
    app = Application(student_id=st.id, company=company.strip()[:255], role=role.strip()[:255],
                      job_url=job_url, source=source, notes=notes)
    db.add(app)
    db.flush()
    origin = "Chrome extension" if source.startswith("extension") else "Added manually"
    award(db, st, "application", r.pts_application, f"Applied · {app.role} at {app.company}",
          source="extension" if source.startswith("extension") else "manual", source_id=app.id,
          created_by=user.id, r=r, note=origin)
    touch(st)
    return app, True


def undo_application(db: DB, st: Student, app: Application, user: User):
    if aware(app.created_at) < now_utc() - timedelta(minutes=15) and user.role == "student":
        raise HTTPException(400, "Applications can only be undone within 15 minutes. Mark it withdrawn instead.")
    ev = db.scalar(select(PointsEvent).where(PointsEvent.source_id == app.id, PointsEvent.event_type == "application"))
    if ev:
        award(db, st, "application_undo", -ev.applied_delta, f"Undone · {app.role} at {app.company}",
              source="manual", source_id=app.id, created_by=user.id)
    db.delete(app)


def log_activity(db: DB, st: Student, *, kind: str, user: User, occurred_on: date, **fields) -> ActivityLog:
    r = get_rules(db)
    monday = week_start(datetime.combine(occurred_on, datetime.min.time(), tzinfo=tz()))
    act = ActivityLog(student_id=st.id, kind=kind, occurred_on=occurred_on, **fields)
    db.add(act)
    db.flush()
    pts, title = 0, ""
    if kind == "linkedin_post":
        if fields.get("post_type") not in ("original", "commentary"):
            raise HTTPException(422, "Only original posts or reposts with your own commentary count")
        if activities_in_week(db, st.id, kind, monday, awarded_only=True) < r.cap_linkedin_posts_week:
            pts = r.pts_linkedin_post
        title = "LinkedIn post · " + ("original" if fields.get("post_type") == "original" else "repost with commentary")
    elif kind == "outreach":
        if activities_in_week(db, st.id, kind, monday, awarded_only=True) < r.cap_outreach_week:
            pts = r.pts_outreach
        title = f"Recruiter outreach · {fields.get('contact_name') or ''} at {fields.get('company') or ''}".strip(" ·")
    elif kind == "networking":
        pts = r.pts_networking
        title = f"Networking · {fields.get('notes') or fields.get('company') or 'logged'}"[:255]
    else:
        raise HTTPException(422, "Unknown activity type")
    if pts:
        act.points_awarded = pts
        award(db, st, kind, pts, title, source="manual", source_id=act.id, created_by=user.id, r=r)
    touch(st)
    return act


def complete_profile_task(db: DB, st: Student, task: str, user: User) -> bool:
    if task not in ("cv", "github", "headshot", "linkedin"):
        raise HTTPException(422, "Unknown profile task")
    if db.scalar(select(ProfileTask).where(ProfileTask.student_id == st.id, ProfileTask.task == task)):
        return False
    db.add(ProfileTask(student_id=st.id, task=task))
    labels = {"cv": "Upload your CV", "github": "GitHub profile ready", "headshot": "Professional headshot",
              "linkedin": "LinkedIn profile optimized"}
    r = get_rules(db)
    award(db, st, "profile_task", r.pts_profile_task, f"Profile task · {labels[task]}",
          source="manual", created_by=user.id, key=f"profile:{st.id}:{task}", r=r)
    touch(st)
    return True


def complete_homework(db: DB, st: Student, task: HomeworkTask, user: User):
    if task.status != "pending":
        raise HTTPException(400, "This task is already " + task.status)
    task.status, task.completed_at = "completed", now_utc()
    award(db, st, "homework", task.point_value, f"Homework done · {task.description[:120]}",
          source="manual", source_id=task.id, created_by=user.id, key=f"homework:{task.id}")
    touch(st)


# ───────────────────────── sessions ─────────────────────────

@dataclass
class Effect:
    event_type: str
    delta: int
    title: str


@dataclass
class SessionPlan:
    effects: list[Effect] = field(default_factory=list)
    missed_tasks: list[HomeworkTask] = field(default_factory=list)
    streak_after: int = 0
    missed_meetings_after: int = 0
    balance_before: int = 0
    balance_after: int = 0
    status_after: str = ""
    notes: list[str] = field(default_factory=list)


def plan_session(db: DB, st: Student, *, session_type: str, attendance: str, session_date: datetime,
                 completed_task_ids: set[str] | None = None) -> SessionPlan:
    """Work out every consequence of logging a session, without writing anything.
    Used both for the advisor's preview and for the actual save, so they can never disagree."""
    r = get_rules(db)
    plan = SessionPlan(streak_after=st.consecutive_homework_misses, missed_meetings_after=st.missed_meetings,
                       balance_before=st.career_points)
    paused = is_paused(st)
    if attendance == "attended":
        pts = {"one_on_one": r.pts_meeting_attended, "group_workshop": r.pts_session_attended,
               "mock_interview": r.pts_mock_interview}[session_type]
        label = {"one_on_one": "1:1 meeting attended", "group_workshop": "GeekForce session attended",
                 "mock_interview": "Mock interview completed"}[session_type]
        plan.effects.append(Effect("meeting" if session_type == "one_on_one" else "session", pts, label))
    elif attendance == "absent":
        plan.missed_meetings_after += 1
        if not paused:
            plan.effects.append(Effect("deduction_absence", r.ded_session_missed, "Session missed without notice"))
        plan.notes.append(f"Counts as {plan.missed_meetings_after} of {r.max_missed_meetings} allowed misses")

    if session_type == "one_on_one" and attendance in ("attended", "absent"):
        session_day = aware(session_date).astimezone(tz()).date()
        due = db.scalars(select(HomeworkTask).where(
            HomeworkTask.student_id == st.id, HomeworkTask.status == "pending")).all()
        due = [t for t in due if t.due_date is None or t.due_date <= session_day]
        completed_task_ids = completed_task_ids or set()
        missed = [t for t in due if t.id not in completed_task_ids]
        plan.missed_tasks = missed
        # Homework finished since the previous 1:1 also counts as "done for this meeting" (resets the streak).
        prev = db.scalar(select(func.max(Session.session_date)).where(
            Session.student_id == st.id, Session.session_type == "one_on_one",
            Session.attendance.in_(["attended", "absent"])))
        done_q = select(func.count(HomeworkTask.id)).where(
            HomeworkTask.student_id == st.id, HomeworkTask.status == "completed")
        if prev:
            done_q = done_q.where(HomeworkTask.completed_at > prev)
        done_since = (db.scalar(done_q) or 0) + len([t for t in due if t.id in completed_task_ids])
        if missed:
            plan.streak_after = st.consecutive_homework_misses + 1
            for t in missed:
                plan.effects.append(Effect("deduction_homework", r.ded_homework_missed,
                                           f"Homework not done · {t.description[:100]}"))
            if plan.streak_after >= 2:
                plan.effects.append(Effect("deduction_streak", r.ded_homework_streak,
                                           f"Homework missed {plan.streak_after} meetings in a row"))
        elif due or done_since:
            plan.streak_after = 0
        if paused:
            plan.effects = [e for e in plan.effects if e.event_type not in AUTO_DEDUCTIONS]

    bal = st.career_points
    for e in plan.effects:
        bal = max(r.points_floor, min(r.points_ceiling, bal + e.delta))
    plan.balance_after = bal
    plan.status_after = compute_status(bal, r) if not paused else st.guarantee_status
    return plan


def log_session(db: DB, st: Student, advisor: User, *, session_type: str, attendance: str,
                session_date: datetime, title: str | None, summary: str | None, resources: list,
                new_homework: list[dict], completed_task_ids: set[str]) -> tuple[Session, SessionPlan]:
    r = get_rules(db)
    # Tasks the advisor confirms were done count as completed (and earn their points) before the check.
    for tid in completed_task_ids:
        t = db.get(HomeworkTask, tid)
        if t and t.student_id == st.id:
            if t.status == "pending":
                complete_homework(db, st, t, advisor)
            t.verified_by_advisor = True
    plan = plan_session(db, st, session_type=session_type, attendance=attendance,
                        session_date=session_date, completed_task_ids=completed_task_ids)
    sess = Session(student_id=st.id, advisor_id=advisor.id, session_date=session_date, session_type=session_type,
                   attendance=attendance, title=title, summary=summary, resources=resources or [])
    db.add(sess)
    db.flush()
    for t in plan.missed_tasks:
        t.status = "missed"
    st.consecutive_homework_misses = plan.streak_after
    st.missed_meetings = plan.missed_meetings_after
    for e in plan.effects:
        award(db, st, e.event_type, e.delta, e.title, source="advisor", source_id=sess.id,
              created_by=advisor.id, r=r, key=f"session:{sess.id}:{e.event_type}:{e.title}"[:160])
    for hw in new_homework:
        db.add(HomeworkTask(session_id=sess.id, student_id=st.id, description=hw["description"],
                            due_date=hw.get("due_date"), point_value=hw.get("point_value") or r.pts_homework))
    if attendance in ("attended", "excused"):
        touch(st)

    # Notifications
    if attendance == "absent" and st.missed_meetings >= r.max_missed_meetings:
        notify_student(db, st, type="critical", category="guarantee", title="Missed-meeting limit reached",
                       body=f"You've missed {st.missed_meetings} meetings without notice. Your advisor will review "
                            f"your guarantee status.", link="/advisor")
        alert_advisor(db, st, f"{st.user.name}: {st.missed_meetings} missed meetings",
                      "Missed-meeting limit reached. Review the guarantee status.")
    if plan.missed_tasks:
        alert_advisor(db, st, f"{st.user.name}: homework not done",
                      f"{len(plan.missed_tasks)} task(s) were still pending at the session.")
    if summary or new_homework:
        hw_lines = "\n".join(f"• {h['description']}" + (f" (due {h['due_date']})" if h.get('due_date') else "")
                             for h in new_homework)
        notify_student(db, st, type="info", category="advisor", pref_key="session_notes",
                       title=f"{advisor.name} added notes" + (f" and {len(new_homework)} homework task(s)" if new_homework else ""),
                       body=(summary or "") + (f"\n\nHomework:\n{hw_lines}" if hw_lines else ""), link="/advisor")
    if attendance == "absent":
        notify_student(db, st, type="deduction", category="deduction",
                       title=f"{r.ded_session_missed}: session missed without notice",
                       body=f"This counts as {st.missed_meetings} of your {r.max_missed_meetings} allowed misses. "
                            "Tell your advisor 24 hours ahead next time and it won't count.", link="/advisor")
    return sess, plan


# ───────────────────────── advisor actions ─────────────────────────

def manual_adjustment(db: DB, st: Student, advisor: User, delta: int, reason: str):
    if not reason or len(reason.strip()) < 5:
        raise HTTPException(422, "A reason is required for manual adjustments")
    ev = award(db, st, "manual_adjustment", delta, ("Points added" if delta >= 0 else "Points removed") + " by advisor",
               source="advisor", note=reason.strip(), created_by=advisor.id)
    db.add(AuditLog(actor_id=advisor.id, student_id=st.id, action="manual_adjustment",
                    detail=f"{delta:+d} · {reason.strip()}", data={"delta": delta}))
    return ev


def report_offer_rejection(db: DB, st: Student, advisor: User, *, company: str, application_id: str | None,
                           justification: str | None, approved: bool):
    r = get_rules(db)
    rep = OfferReport(student_id=st.id, company=company, application_id=application_id,
                      justification=justification, justification_approved=approved, reported_by=advisor.id)
    db.add(rep)
    db.flush()
    if not approved:
        award(db, st, "deduction_offer", r.ded_offer_rejected, f"Valid offer rejected · {company}",
              source="advisor", source_id=rep.id, note=justification, created_by=advisor.id)
        notify_student(db, st, type="deduction", category="deduction",
                       title=f"{r.ded_offer_rejected}: offer from {company} rejected without justification",
                       body="Talk to your advisor if you think this is wrong.", link="/points")
    db.add(AuditLog(actor_id=advisor.id, student_id=st.id, action="offer_rejection",
                    detail=f"{company} · {'justified, no deduction' if approved else f'{r.ded_offer_rejected}'}"))
    return rep


def project_submitted(db: DB, st: Student, advisor: User, title: str):
    r = get_rules(db)
    award(db, st, "project", r.pts_project, f"Project submitted · {title}", source="advisor", created_by=advisor.id)
    touch(st)


# ───────────────────────── pauses ─────────────────────────

def request_pause(db: DB, st: Student, *, start_date: date, end_date: date, reason_type: str, reason: str | None):
    r = get_rules(db)
    days = (end_date - start_date).days + 1
    if days < 1:
        raise HTTPException(422, "The end date must be after the start date")
    if days > r.max_pause_days:
        raise HTTPException(422, f"A pause can be at most {r.max_pause_days} days")
    if start_date < local_today():
        raise HTTPException(422, "A pause can't start in the past")
    if st.pauses_used >= r.pauses_per_cycle:
        raise HTTPException(400, "You've already used your pause for this program cycle")
    if db.scalar(select(PauseRequest).where(PauseRequest.student_id == st.id, PauseRequest.status == "pending")):
        raise HTTPException(400, "You already have a pause request waiting for approval")
    pr = PauseRequest(student_id=st.id, start_date=start_date, end_date=end_date, reason_type=reason_type,
                      reason=reason, extension_days=math.ceil(days * r.pause_deadline_multiplier))
    db.add(pr)
    alert_advisor(db, st, f"{st.user.name} requested a {days}-day pause", f"{reason_type}: {reason or ''}",
                  link="/admin")
    return pr


def decide_pause(db: DB, pr: PauseRequest, actor: User, approve: bool, note: str | None):
    if pr.status != "pending":
        raise HTTPException(400, "This request was already " + pr.status)
    st = db.get(Student, pr.student_id)
    pr.status, pr.decided_by, pr.decided_at, pr.decision_note = (
        "approved" if approve else "declined"), actor.id, now_utc(), note
    days = (pr.end_date - pr.start_date).days + 1
    if approve:
        st.paused_from, st.paused_until = pr.start_date, pr.end_date
        st.pauses_used += 1
        st.deadline_extension_days = (st.deadline_extension_days or 0) + pr.extension_days
        notify_student(db, st, type="info", category="pause", title="Your pause was approved",
                       body=f"{days} days, {pr.start_date:%b %d} to {pr.end_date:%b %d}. Automatic deductions are frozen "
                            f"and your job search deadline moves out by {pr.extension_days} days.", link="/points")
    else:
        notify_student(db, st, type="info", category="pause", title="Your pause request was declined",
                       body=note or "Talk to your advisor for details.", link="/points")
    db.add(AuditLog(actor_id=actor.id, student_id=st.id, action="pause_" + pr.status,
                    detail=f"{days} days · {pr.reason_type} · deadline +{pr.extension_days if approve else 0} days"))
