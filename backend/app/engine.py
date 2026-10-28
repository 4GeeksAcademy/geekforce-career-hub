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

from .i18n import Cat, D, M, lang_of, tr
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
    "deduction_outreach", "deduction_inactivity", "deduction_absence", "deduction_reschedule",
}

STATUS_LABEL = {"secured": "Secured", "at_risk": "At risk", "suspended": "Suspended"}


# ───────────────────────── status ─────────────────────────

def is_paused(st: Student, today: date | None = None) -> bool:
    """Approved pause, or on hold by the Not Started ladder: automatic deductions are frozen."""
    if st.on_hold:
        return True
    today = today or local_today()
    return bool(st.paused_from and st.paused_until and st.paused_from <= today <= st.paused_until)


def weekly_target(st: Student, r: Rules) -> int:
    """Job Guarantee: 15/week. Professional Support (no guarantee): 10/week."""
    return r.weekly_target_prof_support if st.enrollment_plan == "professional_support" else r.weekly_application_target


def quota_applies(st: Student) -> bool:
    """The weekly quota starts at Stage 3 (job hunting). Unknown stage (manual students) → applies."""
    return st.stage in (None, "job_hunting")


def compute_status(points: int, r: Rules) -> str:
    if points >= r.secured_threshold:
        return "secured"
    if points >= r.suspended_below:
        return "at_risk"
    return "suspended"


def refresh_status(db: DB, st: Student, r: Rules | None = None) -> str:
    """Recompute the guarantee status. Suspension is permanent (Policy decision, Oct 2026):
    once suspended, only an admin can reinstate (see reinstate_guarantee)."""
    r = r or get_rules(db)
    if st.status != "active" or st.guarantee_status in ("not_eligible", "suspended") or is_paused(st):
        return st.guarantee_status  # frozen
    new, old = compute_status(st.career_points, r), st.guarantee_status
    if new == old:
        return new
    st.guarantee_status = new
    gap = r.secured_threshold - st.career_points
    if new == "at_risk" and old == "secured":
        notify_student(db, st, type="warning", category="guarantee",
                       title=M("Your Job Guarantee is at risk"),
                       body=M("You're at {points} points, {gap} below {secured}. If you drop below {below}, your guarantee is suspended permanently.",
                              points=st.career_points, gap=gap, secured=r.secured_threshold, below=r.suspended_below),
                       link="/points")
    elif new == "suspended":
        st.suspended_at = now_utc()
        notify_student(db, st, type="critical", category="guarantee",
                       title=M("Your Job Guarantee has been suspended"),
                       body=M("Your balance dropped to {points}, below {below}. Under the GeekForce policy this suspension is permanent. You keep full career support, sessions and points. If you believe this is a mistake, talk to your advisor.",
                              points=st.career_points, below=r.suspended_below),
                       link="/points")
        alert_advisor(db, st, M("{name}: guarantee suspended", name=st.user.name),
                      M("{name} dropped to {points} points. The suspension is permanent unless an admin reinstates it.",
                        name=st.user.name, points=st.career_points))
    elif new == "secured":
        notify_student(db, st, type="success", category="guarantee",
                       title=M("Your Job Guarantee is secured again"),
                       body=M("You're back at {points} points. Keep it up.", points=st.career_points), link="/points")
    return new


def reinstate_guarantee(db: DB, st: Student, admin: User, reason: str, set_points: int | None = None):
    """Admin-only override of a permanent suspension (mistakes, approved appeals). Always audited."""
    r = get_rules(db)
    if st.guarantee_status != "suspended":
        raise HTTPException(400, "This student's guarantee isn't suspended")
    if not reason or len(reason.strip()) < 10:
        raise HTTPException(422, "Explain why the guarantee is being reinstated (at least a sentence)")
    target = set_points if set_points is not None else st.career_points
    if target < r.suspended_below:
        raise HTTPException(422, f"The balance must be at least {r.suspended_below} to reinstate. Set a new balance.")
    if target != st.career_points:
        award(db, st, "manual_adjustment", target - st.career_points, M("Balance corrected on reinstatement"),
              source="admin", note=reason.strip(), created_by=admin.id)
    st.guarantee_status = compute_status(st.career_points, r)
    st.suspended_at = None
    db.add(AuditLog(actor_id=admin.id, student_id=st.id, action="guarantee_reinstated",
                    detail=f"Reinstated at {st.career_points} points · {reason.strip()}"))
    notify_student(db, st, type="success", category="guarantee", title=M("Your Job Guarantee has been reinstated"),
                   body=M("An admin reviewed your case and reinstated your guarantee at {points} points.", points=st.career_points),
                   link="/points")


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
                     balance_after=after, title=tr(title, lang_of(st.user))[:255], source=source, source_id=source_id, note=note,
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
        ActivityLog.student_id == student_id, ActivityLog.kind == kind, ActivityLog.status == "active",
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
    if st.deadline_date:
        deadline = st.deadline_date + timedelta(days=st.deadline_extension_days or 0)
        if start:
            total = (deadline - start).days
    else:
        deadline = start + timedelta(days=total) if start else None
    return {
        "base_days": base, "extension_days": st.deadline_extension_days or 0, "total_days": total,
        "day": (today - start).days + 1 if start else None,
        "deadline": deadline.isoformat() if deadline else None,
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
    award(db, st, "application", r.pts_application, M("Applied · {role} at {company}", role=app.role, company=app.company),
          source="extension" if source.startswith("extension") else "manual", source_id=app.id,
          created_by=user.id, r=r, note=origin)
    touch(st)
    return app, True


def undo_application(db: DB, st: Student, app: Application, user: User):
    if aware(app.created_at) < now_utc() - timedelta(minutes=15) and user.role == "student":
        raise HTTPException(400, "Applications can only be undone within 15 minutes. Mark it withdrawn instead.")
    ev = db.scalar(select(PointsEvent).where(PointsEvent.source_id == app.id, PointsEvent.event_type == "application"))
    if ev:
        award(db, st, "application_undo", -ev.applied_delta, M("Undone · {role} at {company}", role=app.role, company=app.company),
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
        title = M("LinkedIn post · original") if fields.get("post_type") == "original" else M("LinkedIn post · repost with commentary")
    elif kind == "outreach":
        if activities_in_week(db, st.id, kind, monday, awarded_only=True) < r.cap_outreach_week:
            pts = r.pts_outreach
        title = M("Recruiter outreach · {contact} at {company}", contact=fields.get("contact_name") or "—", company=fields.get("company") or "—")
    elif kind == "networking":
        pts = r.pts_networking
        title = M("Networking · {what}", what=(fields.get("notes") or fields.get("company") or "—")[:200])
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
    award(db, st, "profile_task", r.pts_profile_task, M("Profile task · {task}", task=M(labels[task])),
          source="manual", created_by=user.id, key=f"profile:{st.id}:{task}", r=r)
    touch(st)
    return True


def complete_homework(db: DB, st: Student, task: HomeworkTask, user: User):
    if task.status != "pending":
        raise HTTPException(400, "This task is already " + task.status)
    task.status, task.completed_at = "completed", now_utc()
    award(db, st, "homework", task.point_value, M("Homework done · {task}", task=task.description[:120]),
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
    reschedules_after: int = 0
    effective_attendance: str = ""
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
                       reschedules_after=st.reschedules_used or 0, balance_before=st.career_points)
    paused = is_paused(st)
    if attendance == "rescheduled":
        plan.reschedules_after += 1
        n = plan.reschedules_after
        allowed = int(r.reschedules_allowed)
        if n <= allowed:
            ded = r.ded_reschedule_first if n == 1 else r.ded_reschedule_second
            if not paused:
                plan.effects.append(Effect("deduction_reschedule", ded, M("Reschedule {n} in the program", n=n)))
            left = allowed - n
            plan.notes.append(M("Reschedule {n} of {allowed} allowed", n=n, allowed=allowed) if left else
                              M("Reschedule {n} of {allowed} allowed. The next one will count as an absence", n=n, allowed=allowed))
        else:
            attendance = "absent"
            plan.notes.append(M("Reschedule {n}: past the {allowed} allowed, so it counts as an absence", n=n, allowed=allowed))
    plan.effective_attendance = attendance
    if attendance == "attended":
        pts = {"one_on_one": r.pts_meeting_attended, "group_workshop": r.pts_session_attended,
               "mock_interview": r.pts_mock_interview}[session_type]
        label = M({"one_on_one": "1:1 meeting attended", "group_workshop": "GeekForce session attended",
                   "mock_interview": "Mock interview completed"}[session_type])
        plan.effects.append(Effect("meeting" if session_type == "one_on_one" else "session", pts, label))
    elif attendance == "absent":
        plan.missed_meetings_after += 1
        if not paused:
            plan.effects.append(Effect("deduction_absence", r.ded_session_missed, M("Absent from the session")))
        plan.notes.append(M("Counts as {n} of {max} allowed misses", n=plan.missed_meetings_after, max=r.max_missed_meetings))

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
                                           M("Homework not done · {task}", task=t.description[:100])))
            if plan.streak_after >= 2:
                plan.effects.append(Effect("deduction_streak", r.ded_homework_streak,
                                           M("Homework missed {n} meetings in a row", n=plan.streak_after)))
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
    attendance = plan.effective_attendance or attendance
    sess = Session(student_id=st.id, advisor_id=advisor.id, session_date=session_date, session_type=session_type,
                   attendance=attendance, title=title, summary=summary, resources=resources or [])
    db.add(sess)
    db.flush()
    for t in plan.missed_tasks:
        t.status = "missed"
    st.consecutive_homework_misses = plan.streak_after
    st.missed_meetings = plan.missed_meetings_after
    st.reschedules_used = plan.reschedules_after
    for e in plan.effects:
        award(db, st, e.event_type, e.delta, e.title, source="advisor", source_id=sess.id,
              created_by=advisor.id, r=r, key=f"session:{sess.id}:{e.event_type}:{e.title}"[:160])
    for hw in new_homework:
        db.add(HomeworkTask(session_id=sess.id, student_id=st.id, description=hw["description"],
                            due_date=hw.get("due_date"), point_value=hw.get("point_value") or r.pts_homework))
    if attendance in ("attended", "excused", "rescheduled"):
        touch(st)
    if attendance == "attended" and session_type == "one_on_one" and (st.on_hold or st.not_started_level):
        st.on_hold, st.not_started_level = False, 0  # first 1:1 done: leaves the Not Started ladder

    # Notifications
    if attendance == "absent" and st.missed_meetings >= r.max_missed_meetings:
        notify_student(db, st, type="critical", category="guarantee", title=M("Missed-meeting limit reached"),
                       body=M("You've missed {n} meetings. Your advisor will review your guarantee status.", n=st.missed_meetings), link="/advisor")
        alert_advisor(db, st, M("{name}: {n} missed meetings", name=st.user.name, n=st.missed_meetings),
                      M("Missed-meeting limit reached. Review the guarantee status."))
    if plan.missed_tasks:
        alert_advisor(db, st, M("{name}: homework not done", name=st.user.name),
                      M("{n} task(s) were still pending at the session.", n=len(plan.missed_tasks)))
    if summary or new_homework:
        hw_lines = Cat(*[Cat(f"• {h['description']}", M(" (due {date})", date=D(h["due_date"])) if h.get("due_date") else "", sep="")
                         for h in new_homework], sep="\n")
        notify_student(db, st, type="info", category="advisor", pref_key="session_notes",
                       title=(M("{name} added notes and {n} homework task(s)", name=advisor.name, n=len(new_homework)) if new_homework
                              else M("{name} added notes", name=advisor.name)),
                       body=Cat(summary or "", Cat(M("Homework:"), hw_lines, sep="\n") if new_homework else ""), link="/advisor")
    allowed = int(r.reschedules_allowed)
    if attendance == "absent":
        extra = (M(" You had already used your {allowed} reschedules, so this one counts as an absence.", allowed=allowed)
                 if plan.reschedules_after > allowed else "")
        notify_student(db, st, type="deduction", category="deduction",
                       title=M("{pts}: absent from a session", pts=r.ded_session_missed),
                       body=Cat(M("This counts as {n} of your {max} allowed misses.", n=st.missed_meetings, max=r.max_missed_meetings), extra, sep=""),
                       link="/advisor")
    elif attendance == "rescheduled" and plan.effects:
        left = allowed - plan.reschedules_after
        notify_student(db, st, type="deduction", category="deduction",
                       title=M("{pts}: session rescheduled", pts=plan.effects[0].delta),
                       body=Cat(M("You've used {n} of your {allowed} reschedules.", n=plan.reschedules_after, allowed=allowed),
                                M("You have {left} left.", left=left) if left else M("The next reschedule will count as an absence (−10)."), sep=" "),
                       link="/advisor")
    return sess, plan


# ───────────────────────── advisor actions ─────────────────────────

def manual_adjustment(db: DB, st: Student, advisor: User, delta: int, reason: str):
    if not reason or len(reason.strip()) < 5:
        raise HTTPException(422, "A reason is required for manual adjustments")
    ev = award(db, st, "manual_adjustment", delta, (M("Points added by advisor") if delta >= 0 else M("Points removed by advisor")),
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
        award(db, st, "deduction_offer", r.ded_offer_rejected, M("Valid offer rejected · {company}", company=company),
              source="advisor", source_id=rep.id, note=justification, created_by=advisor.id)
        notify_student(db, st, type="deduction", category="deduction",
                       title=M("{pts}: offer from {company} rejected without justification", pts=r.ded_offer_rejected, company=company),
                       body=M("Talk to your advisor if you think this is wrong."), link="/points")
    db.add(AuditLog(actor_id=advisor.id, student_id=st.id, action="offer_rejection",
                    detail=f"{company} · {'justified, no deduction' if approved else f'{r.ded_offer_rejected}'}"))
    return rep


def project_submitted(db: DB, st: Student, advisor: User, title: str):
    r = get_rules(db)
    award(db, st, "project", r.pts_project, M("Project submitted · {title}", title=title), source="advisor", created_by=advisor.id)
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
    alert_advisor(db, st, M("{name} requested a {days}-day pause", name=st.user.name, days=days),
                  Cat(M({"medical": "Medical situation", "family": "Family emergency", "travel": "Pre-approved travel"}.get(reason_type, "Other")), reason or "", sep=": "),
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
        notify_student(db, st, type="info", category="pause", title=M("Your pause was approved"),
                       body=M("{days} days, {start} to {end}. Automatic deductions are frozen and your job search deadline moves out by {ext} days.",
                              days=days, start=D(pr.start_date), end=D(pr.end_date), ext=pr.extension_days), link="/points")
    else:
        notify_student(db, st, type="info", category="pause", title=M("Your pause request was declined"),
                       body=note or M("Talk to your advisor for details."), link="/points")
    db.add(AuditLog(actor_id=actor.id, student_id=st.id, action="pause_" + pr.status,
                    detail=f"{days} days · {pr.reason_type} · deadline +{pr.extension_days if approve else 0} days"))


# ───────────────────────── verification & onboarding ─────────────────────────

def reject_activity(db: DB, act: ActivityLog, advisor: User, reason: str):
    """Advisor couldn't verify a self-reported entry: remove its points and tell the student."""
    if act.status == "rejected":
        raise HTTPException(400, "Already rejected")
    if not reason or len(reason.strip()) < 5:
        raise HTTPException(422, "Tell the student why the entry was rejected")
    st = db.get(Student, act.student_id)
    act.status, act.rejected_reason, act.verified_by = "rejected", reason.strip(), advisor.id
    label = {"linkedin_post": "LinkedIn post", "outreach": "Recruiter outreach", "networking": "Networking action"}[act.kind]
    if act.points_awarded:
        ev = db.scalar(select(PointsEvent).where(PointsEvent.source_id == act.id, PointsEvent.event_type == act.kind))
        award(db, st, "activity_rejected", -(ev.applied_delta if ev else act.points_awarded),
              M("{label} rejected by advisor", label=M(label)), source="advisor", source_id=act.id, note=reason.strip(),
              created_by=advisor.id, key=f"reject:{act.id}")
        act.points_awarded = 0
    notify_student(db, st, type="deduction", category="deduction", title=M("Your {label} entry was rejected", label=M(label)),
                   body=f"{advisor.name}: {reason.strip()}", link="/tracker")
    db.add(AuditLog(actor_id=advisor.id, student_id=st.id, action="activity_rejected", detail=f"{label} · {reason.strip()}"))


def suggested_starting_balance(db: DB, st: Student) -> dict:
    r = get_rules(db)
    recent = db.scalar(select(func.count(Application.id)).where(
        Application.student_id == st.id, Application.applied_at >= now_utc() - timedelta(days=30))) or 0
    total = db.scalar(select(func.count(Application.id)).where(Application.student_id == st.id)) or 0
    value = min(r.points_ceiling, r.starting_points + recent * r.pts_application)
    return {"suggested": value, "applications_last_30_days": recent, "applications_total": total,
            "formula": f"{r.starting_points} + {r.pts_application} × {recent} applications in the last 30 days, max {r.points_ceiling}"}


def activate_student(db: DB, st: Student, advisor: User, starting_points: int, note: str | None = None):
    r = get_rules(db)
    if st.status != "onboarding":
        raise HTTPException(400, "This student is already active")
    if not (r.points_floor <= starting_points <= r.points_ceiling):
        raise HTTPException(422, f"The starting balance must be between {r.points_floor} and {r.points_ceiling}")
    st.status, st.activated_at = "active", now_utc()
    st.career_points = starting_points
    db.add(PointsEvent(student_id=st.id, event_type="starting_balance", delta=starting_points,
                       applied_delta=starting_points, balance_after=starting_points,
                       title="Starting balance set by advisor", source="advisor", note=note, created_by=advisor.id))
    if st.guarantee_status != "not_eligible":
        st.guarantee_status = compute_status(starting_points, r)
        if st.guarantee_status == "suspended":
            st.suspended_at = now_utc()
    if not st.job_search_start_date:
        st.job_search_start_date = local_today()
    touch(st)
    db.add(AuditLog(actor_id=advisor.id, student_id=st.id, action="student_activated",
                    detail=f"Starting balance {starting_points}" + (f" · {note}" if note else "")))
