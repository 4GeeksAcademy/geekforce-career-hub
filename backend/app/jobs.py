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

from .i18n import Cat, D, M
from .db import SessionLocal
from .engine import (
    applications_in_week, award, compute_status, is_paused, quota_applies, refresh_status, weekly_target,
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
        if not quota_applies(st):
            out["skipped"] += 1
            continue
        target = weekly_target(st, r)
        n = applications_in_week(db, st.id, last_monday)
        key = f"weekly:{st.id}:{last_monday.isoformat()}"
        if n >= target:
            if award(db, st, "weekly_bonus", r.pts_weekly_bonus, M("Weekly goal met · {n} applications", n=n),
                     source="weekly_check", key=key, r=r):
                out["bonus"] += 1
        elif is_paused(st, today):
            out["skipped"] += 1
        else:
            ev = award(db, st, "deduction_weekly", r.ded_weekly_target_missed,
                       M("Weekly goal missed · {n} of {target} applications", n=n, target=target),
                       source="weekly_check", key=key, r=r)
            if ev:
                out["deducted"] += 1
                notify_student(db, st, type="deduction", category="deduction",
                               title=M("{pts}: last week ended at {n} of {target}", pts=r.ded_weekly_target_missed, n=n, target=target),
                               body=M("This week's target is {target}. Hit it for a +{bonus} bonus.", target=target, bonus=r.pts_weekly_bonus),
                               link="/tracker")
    db.commit()
    return out


def friday_nudge(db: DB, today: date | None = None) -> dict:
    today = today or local_today()
    r = get_rules(db)
    monday = today - timedelta(days=today.weekday())
    sent = 0
    for st in _active_students(db):
        if is_paused(st, today) or not quota_applies(st):
            continue
        target = weekly_target(st, r)
        n = applications_in_week(db, st.id, monday)
        if n < target:
            left = target - n
            if notify_student(db, st, type="warning", category="reminder", pref_key="weekly_nudge", email=False,
                              title=M("{n} applications to go this week", n=left),
                              body=M("You're at {n} of {target}. Your week closes Sunday at 11:59 PM.", n=n, target=target),
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
        ActivityLog.student_id == st.id, ActivityLog.kind == kind, ActivityLog.status == "active"))
    anchors = [d for d in (st.job_search_start_date, last_act, _last_event_date(db, st, event_type),
                           st.paused_until) if d]
    if not anchors:
        return None
    anchor = max(anchors)
    if (today - anchor).days >= days and not is_paused(st, today):
        ev = award(db, st, event_type, delta, M("No {what} in {days} days", what=M(label), days=days), source="automatic",
                   key=f"{event_type}:{st.id}:{today.isoformat()}")
        if ev:
            notify_student(db, st, type="deduction", category="deduction",
                           title=M("{pts}: no {what} in {days} days", pts=delta, what=M(label), days=days),
                           body=M("Log a LinkedIn post to stop the clock.") if kind == "linkedin_post" else M("Log a recruiter outreach message to stop the clock."),
                           link="/tracker")
        return ev
    return None


def _last_activity(db: DB, st: Student) -> date | None:
    # Real actions only: logging in does not stop the inactivity clock (decision Oct 2026).
    stamps = [aware(st.last_activity_at)]
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
                       title=M("You've been inactive for {n} days", n=idle),
                       body=M("On day {day} you lose {pts} points. Log an application, book a session, or request a pause.",
                              day=r.inactivity_days + 1, pts=abs(r.ded_inactivity_initial)), link="/")
    if idle > r.inactivity_days:
        # day 31 → initial deduction, then every 7 days
        n = (idle - r.inactivity_days - 1) // 7
        if (idle - r.inactivity_days - 1) % 7 == 0:
            delta = r.ded_inactivity_initial if n == 0 else r.ded_inactivity_weekly
            ev = award(db, st, "deduction_inactivity", delta, M("Inactive for {n} days", n=idle), source="automatic",
                       key=f"inactive:{st.id}:{last.isoformat()}:{n}")
            if ev:
                notify_student(db, st, type="critical", category="inactivity",
                               title=M("{pts}: inactive for {n} days", pts=delta, n=idle),
                               body=M("Get active again or ask your advisor about a pause."), link="/")
                alert_advisor(db, st, M("{name}: inactive {n} days", name=st.user.name, n=idle), M("Deduction of {pts} applied.", pts=delta))


def _not_started_ladder(db: DB, st: Student, today: date, r):
    """No first 1:1 yet: day 7 follow-up, day 15 on hold, day 30 guarantee lost (permanent)."""
    had_first = db.scalar(select(func.count(Session.id)).where(
        Session.student_id == st.id, Session.session_type == "one_on_one", Session.attendance == "attended"))
    if had_first:
        return
    if not st.activated_at:  # the ladder counts from activation in Career Hub
        return
    anchor = aware(st.activated_at).astimezone(tz()).date()
    day = (today - anchor).days
    name = st.user.name
    if day >= r.not_started_loss_day and st.not_started_level < 30:
        st.not_started_level = 30
        if st.guarantee_status not in ("not_eligible", "suspended"):
            st.guarantee_status, st.suspended_at = "suspended", now_utc()
            notify_student(db, st, type="critical", category="guarantee", title=M("Your Job Guarantee has been suspended"),
                           body=M("{day} days without your first 1:1 with GeekForce. Under the policy the guarantee is lost. You still have career support: book your first session now.", day=day),
                           link="/advisor")
            alert_advisor(db, st, M("{name}: guarantee lost (Not Started day {day})", name=name, day=day), M("No first 1:1 in 30 days."))
    elif day >= r.not_started_hold_day and st.not_started_level < 15:
        st.not_started_level, st.on_hold = 15, True
        notify_student(db, st, type="critical", category="inactivity", title=M("Your GeekForce process is on hold"),
                       body=M("{day} days without your first 1:1. Book it now: on day {loss} the Job Guarantee is lost.", day=day, loss=r.not_started_loss_day),
                       link="/advisor")
        alert_advisor(db, st, M("{name}: on hold (Not Started day {day})", name=name, day=day), M("No first 1:1 yet. Reach out today."))
    elif day >= r.not_started_followup_day and st.not_started_level < 7:
        st.not_started_level = 7
        notify_student(db, st, type="warning", category="reminder", title=M("Book your first GeekForce 1:1"),
                       body=M("It's been {day} days. On day {hold} your process goes on hold.", day=day, hold=r.not_started_hold_day), link="/advisor")
        alert_advisor(db, st, M("{name}: no first 1:1 after {day} days", name=name, day=day), M("Follow up by Slack and email."))


def daily(db: DB, today: date | None = None) -> dict:
    today = today or local_today()
    r = get_rules(db)
    # Pauses: activate approved ones starting today; end ones that finished yesterday.
    for pr in db.scalars(select(PauseRequest).where(PauseRequest.status == "approved")).all():
        st = db.get(Student, pr.student_id)
        if pr.end_date < today:
            pr.status = "ended"
            st.paused_from = st.paused_until = None
            notify_student(db, st, type="info", category="pause", title=M("Welcome back: your pause has ended"),
                           body=M("All checks are running again. Your deadline already includes the extension."), link="/")
            refresh_status(db, st, r)
    for st in _active_students(db):
        _not_started_ladder(db, st, today, r)
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
                       title=M("Homework due in 48 hours"),
                       body=M("“{task}” is due {date}. Done on time: +{pts}.", task=t.description, date=D(t.due_date, "long"), pts=t.point_value),
                       link="/advisor")
        t.reminder_sent = True
        n += 1
    for pr in db.scalars(select(PauseRequest).where(
            PauseRequest.status == "approved", PauseRequest.reminder_sent.is_(False),
            PauseRequest.end_date == today + timedelta(days=3))).all():
        st = db.get(Student, pr.student_id)
        notify_student(db, st, type="reminder", category="pause", title=M("Your pause ends in 3 days"),
                       body=M("Checks resume after {date}.", date=D(pr.end_date)), link="/points")
        pr.reminder_sent = True
    db.commit()
    return {"homework_reminders": n}


def notion_sync(db: DB, today: date | None = None) -> dict:
    from .notion_sync import run_sync
    return run_sync(db)


def job_radar(db: DB) -> dict:
    from .job_radar import sweep_adzuna
    return sweep_adzuna(db)


def ac_sync(db: DB) -> dict:
    """Nightly: keep ActiveCampaign fields and status tags current for every student (no emails)."""
    from .services import activecampaign as ac
    if not ac.configured():
        return {"ok": False, "error": "ActiveCampaign isn't connected"}
    ok = failed = 0
    for st in db.scalars(select(Student).where(Student.status.in_(["active", "hired"]))).all():
        if ac.sync_student(st):
            ok += 1
        else:
            failed += 1
    return {"ok": True, "synced": ok, "failed": failed}


JOBS = {"weekly_check": weekly_check, "friday_nudge": friday_nudge, "daily": daily, "reminders": reminders,
        "notion_sync": notion_sync, "job_radar": job_radar, "ac_sync": ac_sync}


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
    from .config import settings
    if settings.notion_token:
        sched.add_job(run_job, CronTrigger(hour=0, minute=30), args=["notion_sync"], id="notion_sync")
    if settings.adzuna_app_id and settings.adzuna_app_key:
        sched.add_job(run_job, CronTrigger(hour=10, minute=0), args=["job_radar"], id="job_radar")
    if settings.ac_url and settings.ac_key:
        sched.add_job(run_job, CronTrigger(hour=2, minute=0), args=["ac_sync"], id="ac_sync")
    sched.start()
    return sched
