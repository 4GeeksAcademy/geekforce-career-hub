"""Scheduled checks (Points Policy §7). Each job is idempotent: running it twice never double-charges.

Schedule (local time, settings.timezone):
  weekly_check     Mon 06:00  — previous week's applications: +10 bonus or −10
  friday_nudge     Fri 17:00  — in-app warning if under target this week
  daily            01:00      — pauses, LinkedIn/outreach 14-day checks, 30-day inactivity, status refresh
  reminders        09:00      — homework due in 48h, pause ending in 3 days
"""
import logging
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

from .db import SessionLocal
from .engine import (
    applications_in_week, award, is_paused, refresh_status,
)
from .models import ActivityLog, Application, HomeworkTask, PauseRequest, PointsEvent, Session, Student, User
from .notify import alert_advisor, notify_student
from .rules import get_rules
from .timeutil import aware, local_today, now_utc, tz, week_start

log = logging.getLogger("geekforce.jobs")


def _active_students(db: DB):
    return db.scalars(select(Student).join(User, Student.user_id == User.id).where(
        Student.status == "active", User.is_active.is_(True))).all()


def weekly_check(db: DB, today: date | None = None) -> dict:
    """Run Monday morning: evaluate the week that just ended."""
    today = today or local_today()
    r = get_rules(db)
    last_monday = today - timedelta(days=today.weekday()) - timedelta(days=7)
    out = {"bonus": 0, "deducted": 0, "skipped": 0}
    for st in _active_students(db):
        if st.job_search_start_date and st.job_search_start_date > last_monday + timedelta(days=6):
            out["skipped"] += 1
            continue
        n = applications_in_week(db, st.id, last_monday)
        key = f"weekly:{st.id}:{last_monday.isoformat()}"
        if n >= r.weekly_application_target:
            if award(db, st, "weekly_bonus", r.pts_weekly_bonus, f"Weekly goal met · {n} applications",
                     source="weekly_check", key=key, r=r):
                out["bonus"] += 1
        elif is_paused(st, today):
            out["skipped"] += 1
        else:
            ev = award(db, st, "deduction_weekly", r.ded_weekly_target_missed,
                       f"Weekly goal missed · {n} of {r.weekly_application_target} applications",
                       source="weekly_check", key=key, r=r)
            if ev:
                out["deducted"] += 1
                notify_student(db, st, type="deduction", category="deduction",
                               title=f"{r.ded_weekly_target_missed}: last week ended at {n} of {r.weekly_application_target}",
                               body=f"This week's target is {r.weekly_application_target}. Hit it for a +{r.pts_weekly_bonus} bonus.",
                               link="/tracker")
    db.commit()
    return out


def friday_nudge(db: DB, today: date | None = None) -> dict:
    today = today or local_today()
    r = get_rules(db)
    monday = today - timedelta(days=today.weekday())
    sent = 0
    for st in _active_students(db):
        if is_paused(st, today):
            continue
        n = applications_in_week(db, st.id, monday)
        if n < r.weekly_application_target:
            left = r.weekly_application_target - n
            if notify_student(db, st, type="warning", category="reminder", pref_key="weekly_nudge", email=False,
                              title=f"{left} applications to go this week",
                              body=f"You're at {n} of {r.weekly_application_target}. Your week closes Sunday at 11:59 PM.",
                              link="/tracker"):
                sent += 1
    db.commit()
    return {"nudged": sent}


def _last_event_date(db: DB, st: Student, event_type: str) -> date | None:
    ts = db.scalar(select(func.max(PointsEvent.created_at)).where(
        PointsEvent.student_id == st.id, PointsEvent.event_type == event_type))
    return aware(ts).astimezone(tz()).date() if ts else None


def _window_check(db: DB, st: Student, today: date, kind: str, event_type: str, days: int, delta: int, label: str):
    """−delta if no `kind` activity in `days` days. Clock starts at the latest of: job search start,
    last activity of that kind, last penalty of this type, or end of the last pause."""
    last_act = db.scalar(select(func.max(ActivityLog.occurred_on)).where(
        ActivityLog.student_id == st.id, ActivityLog.kind == kind))
    anchors = [d for d in (st.job_search_start_date, last_act, _last_event_date(db, st, event_type),
                           st.paused_until) if d]
    if not anchors:
        return None
    anchor = max(anchors)
    if (today - anchor).days >= days and not is_paused(st, today):
        ev = award(db, st, event_type, delta, f"No {label} in {days} days", source="automatic",
                   key=f"{event_type}:{st.id}:{today.isoformat()}")
        if ev:
            notify_student(db, st, type="deduction", category="deduction",
                           title=f"{delta}: no {label} in {days} days",
                           body=f"Log {'a LinkedIn post' if kind == 'linkedin_post' else 'a recruiter outreach message'} "
                                "to stop the clock.", link="/tracker")
        return ev
    return None


def _last_activity(db: DB, st: Student) -> date | None:
    stamps = [aware(st.last_activity_at), aware(st.user.last_login_at)]
    stamps.append(aware(db.scalar(select(func.max(Application.applied_at)).where(Application.student_id == st.id))))
    stamps.append(aware(db.scalar(select(func.max(Session.session_date)).where(
        Session.student_id == st.id, Session.attendance.in_(["attended", "excused", "scheduled"]),
        Session.session_date <= now_utc()))))
    days = [s.astimezone(tz()).date() for s in stamps if s]
    if st.job_search_start_date:
        days.append(st.job_search_start_date)
    if st.paused_until:
        days.append(st.paused_until)
    return max(days) if days else None


def _inactivity(db: DB, st: Student, today: date):
    r = get_rules(db)
    last = _last_activity(db, st)
    if not last or is_paused(st, today):
        return
    idle = (today - last).days
    if idle == r.inactivity_warning_day:
        notify_student(db, st, type="warning", category="inactivity",
                       title=f"You've been inactive for {idle} days",
                       body=f"On day {r.inactivity_days + 1} you lose {abs(r.ded_inactivity_initial)} points. "
                            "Log an application, book a session, or request a pause.", link="/")
    if idle > r.inactivity_days:
        # day 31 → initial deduction, then every 7 days
        n = (idle - r.inactivity_days - 1) // 7
        if (idle - r.inactivity_days - 1) % 7 == 0:
            delta = r.ded_inactivity_initial if n == 0 else r.ded_inactivity_weekly
            ev = award(db, st, "deduction_inactivity", delta, f"Inactive for {idle} days", source="automatic",
                       key=f"inactive:{st.id}:{last.isoformat()}:{n}")
            if ev:
                notify_student(db, st, type="critical", category="inactivity",
                               title=f"{delta}: inactive for {idle} days",
                               body="Get active again or ask your advisor about a pause.", link="/")
                alert_advisor(db, st, f"{st.user.name}: inactive {idle} days", f"Deduction of {delta} applied.")


def daily(db: DB, today: date | None = None) -> dict:
    today = today or local_today()
    r = get_rules(db)
    # Pauses: activate approved ones starting today; end ones that finished yesterday.
    for pr in db.scalars(select(PauseRequest).where(PauseRequest.status == "approved")).all():
        st = db.get(Student, pr.student_id)
        if pr.end_date < today:
            pr.status = "ended"
            st.paused_from = st.paused_until = None
            notify_student(db, st, type="info", category="pause", title="Welcome back: your pause has ended",
                           body="All checks are running again. Your deadline already includes the extension.", link="/")
            refresh_status(db, st, r)
    for st in _active_students(db):
        _window_check(db, st, today, "linkedin_post", "deduction_linkedin", r.linkedin_inactive_days,
                      r.ded_linkedin_inactive, "LinkedIn activity")
        _window_check(db, st, today, "outreach", "deduction_outreach", r.outreach_inactive_days,
                      r.ded_outreach_inactive, "recruiter outreach")
        _inactivity(db, st, today)
        refresh_status(db, st, r)
    db.commit()
    return {"ok": True}


def reminders(db: DB, today: date | None = None) -> dict:
    today = today or local_today()
    n = 0
    for t in db.scalars(select(HomeworkTask).where(
            HomeworkTask.status == "pending", HomeworkTask.reminder_sent.is_(False),
            HomeworkTask.due_date == today + timedelta(days=2))).all():
        st = db.get(Student, t.student_id)
        notify_student(db, st, type="reminder", category="reminder", pref_key="homework_reminder",
                       title="Homework due in 48 hours",
                       body=f"“{t.description}” is due {t.due_date:%A, %b %d}. Done on time: +{t.point_value}.",
                       link="/advisor")
        t.reminder_sent = True
        n += 1
    for pr in db.scalars(select(PauseRequest).where(
            PauseRequest.status == "approved", PauseRequest.reminder_sent.is_(False),
            PauseRequest.end_date == today + timedelta(days=3))).all():
        st = db.get(Student, pr.student_id)
        notify_student(db, st, type="reminder", category="pause", title="Your pause ends in 3 days",
                       body=f"Checks resume after {pr.end_date:%b %d}.", link="/points")
        pr.reminder_sent = True
    db.commit()
    return {"homework_reminders": n}


JOBS = {"weekly_check": weekly_check, "friday_nudge": friday_nudge, "daily": daily, "reminders": reminders}


def run_job(name: str) -> dict:
    with SessionLocal() as db:
        result = JOBS[name](db)
        log.info("job %s → %s", name, result)
        return result


def start_scheduler():
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    sched = BackgroundScheduler(timezone=str(tz()))
    sched.add_job(run_job, CronTrigger(day_of_week="mon", hour=6, minute=0), args=["weekly_check"], id="weekly_check")
    sched.add_job(run_job, CronTrigger(day_of_week="fri", hour=17, minute=0), args=["friday_nudge"], id="friday_nudge")
    sched.add_job(run_job, CronTrigger(hour=1, minute=0), args=["daily"], id="daily")
    sched.add_job(run_job, CronTrigger(hour=9, minute=0), args=["reminders"], id="reminders")
    sched.start()
    return sched
