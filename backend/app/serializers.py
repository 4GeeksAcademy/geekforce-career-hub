"""Plain-dict serializers shared by the routers."""
from .i18n import D, L
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

from .engine import activities_in_week, applications_in_week, deadline_info, is_paused, quota_applies, weekly_target
from .models import (
    ActivityLog, Application, HomeworkTask, Notification, PauseRequest, PointsEvent, ProfileTask, Session, Student,
)
from .rules import Rules, get_rules
from .timeutil import aware, local_today, now_utc, week_bounds_utc, week_start


def initials(name: str) -> str:
    parts = [p for p in name.split() if p]
    return ((parts[0][0] if parts else "?") + (parts[-1][0] if len(parts) > 1 else "")).upper()


def iso(dt):
    return aware(dt).isoformat() if dt else None


def event_dict(e: PointsEvent) -> dict:
    return {"id": e.id, "type": e.event_type, "title": e.title, "delta": e.delta, "applied_delta": e.applied_delta,
            "balance_after": e.balance_after, "source": e.source, "note": e.note, "created_at": iso(e.created_at)}


def application_dict(a: Application) -> dict:
    return {"id": a.id, "company": a.company, "role": a.role, "job_url": a.job_url, "status": a.status,
            "source": a.source, "notes": a.notes, "followup_date": a.followup_date.isoformat() if a.followup_date else None,
            "applied_at": iso(a.applied_at), "created_at": iso(a.created_at)}


def activity_dict(a: ActivityLog) -> dict:
    return {"id": a.id, "kind": a.kind, "contact_name": a.contact_name, "company": a.company, "platform": a.platform,
            "url": a.url, "post_type": a.post_type, "notes": a.notes, "occurred_on": a.occurred_on.isoformat(),
            "points_awarded": a.points_awarded, "status": a.status, "rejected_reason": a.rejected_reason}


def homework_dict(t: HomeworkTask) -> dict:
    return {"id": t.id, "session_id": t.session_id, "description": t.description,
            "due_date": t.due_date.isoformat() if t.due_date else None, "due_by_next_meeting": t.due_date is None,
            "point_value": t.point_value,
            "status": t.status, "completed_at": iso(t.completed_at), "verified_by_advisor": t.verified_by_advisor}


def session_dict(s: Session, db: DB | None = None) -> dict:
    earned = None
    if db is not None:
        earned = db.scalar(select(func.coalesce(func.sum(PointsEvent.applied_delta), 0)).where(
            PointsEvent.source_id == s.id))
    return {"id": s.id, "session_date": iso(s.session_date), "session_type": s.session_type,
            "attendance": s.attendance, "title": s.title, "summary": s.summary, "resources": s.resources or [],
            "advisor": s.advisor.name if s.advisor else None, "points": earned,
            "homework": [homework_dict(t) for t in s.homework]}


def interaction_dict(i) -> dict:
    return {"id": i.id, "occurred_at": iso(i.occurred_at), "channel": i.channel, "summary": i.summary,
            "visibility": i.visibility, "advisor": i.advisor.name if i.advisor else None,
            "follow_up_date": i.follow_up_date.isoformat() if i.follow_up_date else None,
            "follow_up_done": i.follow_up_done}


def notification_dict(n: Notification) -> dict:
    return {"id": n.id, "type": n.type, "category": n.category, "title": n.title, "body": n.body, "link": n.link,
            "read": n.read, "email_sent": n.email_sent, "created_at": iso(n.created_at)}


def pause_dict(p: PauseRequest, st: Student | None = None, db: DB | None = None) -> dict:
    d = {"id": p.id, "student_id": p.student_id, "start_date": p.start_date.isoformat(),
         "end_date": p.end_date.isoformat(), "days": (p.end_date - p.start_date).days + 1,
         "reason_type": p.reason_type, "reason": p.reason, "status": p.status, "extension_days": p.extension_days,
         "created_at": iso(p.created_at), "decision_note": p.decision_note}
    if st is not None and db is not None:
        d["student_name"] = st.user.name
        d["student_initials"] = initials(st.user.name)
        d["pauses_used"] = st.pauses_used
        info = deadline_info(db, st)
        d["deadline_before"] = info["deadline"]
        if st.job_search_start_date and p.status == "pending":
            d["deadline_after"] = (st.job_search_start_date + timedelta(
                days=info["total_days"] + p.extension_days)).isoformat()
        else:
            d["deadline_after"] = info["deadline"]
    return d


def student_brief(st: Student) -> dict:
    c = st.cohort
    return {"id": st.id, "name": st.user.name, "email": st.user.email, "initials": initials(st.user.name),
            "cohort": c.name if c else None, "program": c.program if c else None,
            "location": c.location if c else None, "region": c.region if c else None,
            "advisor": st.advisor.name if st.advisor else None, "advisor_id": st.advisor_id,
            "points": st.career_points, "guarantee_status": st.guarantee_status, "status": st.status,
            "paused": is_paused(st), "paused_until": st.paused_until.isoformat() if st.paused_until else None,
            "on_hold": st.on_hold, "stage": st.stage, "enrollment_plan": st.enrollment_plan,
            "suspended_at": iso(st.suspended_at), "from_notion": bool(st.notion_page_id),
            "reschedules_used": st.reschedules_used or 0, "missed_meetings": st.missed_meetings,
            "payments_behind": st.payments_behind, "status_reason": st.status_reason,
            "status_changed_at": iso(st.status_changed_at)}


def _last(db, model_col, *where):
    return db.scalar(select(func.max(model_col)).where(*where))


def guarantee_conditions(db: DB, st: Student, r: Rules) -> list[dict]:
    today = local_today()
    monday = week_start()
    apps = applications_in_week(db, st.id, monday)
    last_post = _last(db, ActivityLog.occurred_on, ActivityLog.student_id == st.id, ActivityLog.kind == "linkedin_post", ActivityLog.status == "active")
    last_out = _last(db, ActivityLog.occurred_on, ActivityLog.student_id == st.id, ActivityLog.kind == "outreach", ActivityLog.status == "active")
    start = st.job_search_start_date or today

    def by(last, days):
        anchor = max([d for d in (last, start) if d])
        return anchor + timedelta(days=days)

    offers = db.scalars(select(Application).where(Application.student_id == st.id, Application.status == "offer")).all()
    gap = r.secured_threshold - st.career_points
    hw = st.consecutive_homework_misses
    lp = L("Last post {date}. ", date=D(last_post)) if last_post else L("No posts logged yet. ")
    lo = L("Last outreach {date}. ", date=D(last_out)) if last_out else L("No outreach logged yet. ")
    wt = weekly_target(st, r)
    return [
        {"key": "points", "title": L("Stay at {n} points or more", n=r.secured_threshold),
         "detail": L("You are at {points}. Below {below} your guarantee is suspended.", points=st.career_points, below=r.suspended_below),
         "ok": gap <= 0, "badge": L("On track") if gap <= 0 else L("{n} pts short", n=gap)},
        {"key": "applications", "title": L("Hit {n} applications each week", n=wt),
         "detail": L("{n} so far this week. Closes Sunday 11:59 PM.", n=apps),
         "ok": apps >= wt, "badge": f"{apps} / {wt}"},
        {"key": "homework", "title": L("Do your homework before each meeting"),
         "detail": (L("No misses in a row.") if hw == 0 else
                    L("{n} miss in a row. A second miss adds {pts}.", n=hw, pts=r.ded_homework_streak)),
         "ok": hw == 0, "badge": L("Clear") if hw == 0 else L("{n} in a row", n=hw)},
        {"key": "meetings", "title": L("Miss no more than {n} meetings", n=r.max_missed_meetings),
         "detail": L("{n} unexcused miss(es) so far.", n=st.missed_meetings),
         "ok": st.missed_meetings < r.max_missed_meetings, "badge": f"{st.missed_meetings} / {r.max_missed_meetings}"},
        {"key": "linkedin", "title": L("Stay active on LinkedIn"),
         "detail": lp + L("Post by {date}.", date=D(by(last_post, r.linkedin_inactive_days))),
         "ok": (today - max([d for d in (last_post, start) if d])).days < r.linkedin_inactive_days - 3, "badge": None},
        {"key": "outreach", "title": L("Keep reaching out to recruiters"),
         "detail": lo + L("Log one by {date}.", date=D(by(last_out, r.outreach_inactive_days))),
         "ok": (today - max([d for d in (last_out, start) if d])).days < r.outreach_inactive_days - 3, "badge": None},
        {"key": "offers", "title": L("Don't reject a valid offer without a reason"),
         "detail": (L("Open offer: {company}. Talk to your advisor before deciding.", company=offers[0].company) if offers
                    else L("No open offers.")), "ok": True, "badge": L("Clear")},
    ]


def next_actions(db: DB, st: Student, r: Rules) -> list[dict]:
    monday = week_start()
    apps = applications_in_week(db, st.id, monday)
    gap = max(0, r.secured_threshold - st.career_points)
    acts = []
    remaining = max(0, weekly_target(st, r) - apps) if quota_applies(st) else 0
    if remaining:
        n_gap = -(-gap // r.pts_application) if gap else 0
        if gap and n_gap <= remaining:
            acts.append({"title": L("Apply to {n} more job(s) today", n=n_gap),
                         "why": L("Puts you back at {n} and secures your guarantee.", n=r.secured_threshold),
                         "points": n_gap * r.pts_application, "link": "/tracker"})
        else:
            acts.append({"title": L("Apply to {n} more jobs by Sunday", n=remaining),
                         "why": L("+{pts} pts, a +{bonus} bonus, and no −{penalty} on Monday.", pts=remaining * r.pts_application,
                                  bonus=r.pts_weekly_bonus, penalty=abs(r.ded_weekly_target_missed)),
                         "points": remaining * r.pts_application + r.pts_weekly_bonus, "link": "/tracker"})
    pending = db.scalars(select(HomeworkTask).where(HomeworkTask.student_id == st.id,
                                                    HomeworkTask.status == "pending")).all()
    if pending:
        pts = sum(t.point_value for t in pending)
        acts.append({"title": L("Finish your {n} homework task(s)", n=len(pending)),
                     "why": L("Earns +{pts} and avoids −{loss} at your next meeting.", pts=pts, loss=abs(len(pending) * r.ded_homework_missed)),
                     "points": pts, "link": "/advisor"})
    originals = db.scalar(select(func.count(ActivityLog.id)).where(
        ActivityLog.student_id == st.id, ActivityLog.kind == "linkedin_post", ActivityLog.post_type == "original",
        ActivityLog.occurred_on >= monday, ActivityLog.status == "active")) or 0
    if originals == 0:
        acts.append({"title": L("Publish one original LinkedIn post"),
                     "why": L("Your weekly requirement. Up to {n} posts earn points.", n=r.cap_linkedin_posts_week),
                     "points": r.pts_linkedin_post, "link": "/tracker#linkedin"})
    if activities_in_week(db, st.id, "outreach", monday, awarded_only=True) < r.cap_outreach_week:
        acts.append({"title": L("Message a recruiter and log it"),
                     "why": L("Up to {n} messages a week earn points.", n=r.cap_outreach_week),
                     "points": r.pts_outreach, "link": "/tracker#outreach"})
    done = {t for (t,) in db.execute(select(ProfileTask.task).where(ProfileTask.student_id == st.id))}
    missing = [t for t in ("cv", "github", "linkedin", "headshot") if t not in done]
    if missing:
        acts.append({"title": L("Complete {n} profile task(s)", n=len(missing)),
                     "why": L("CV, GitHub, LinkedIn and headshot each earn points once."),
                     "points": len(missing) * r.pts_profile_task, "link": "/resume"})
    return acts[:4]


def stage_progress(db: DB, st: Student, target: int) -> dict:
    from .stages import progress
    return progress(db, st, target)


def dashboard(db: DB, st: Student) -> dict:
    r = get_rules(db)
    monday = week_start()
    apps = applications_in_week(db, st.id, monday)
    _, week_end = week_bounds_utc(monday)
    upcoming = db.scalars(select(Session).where(
        Session.student_id == st.id, Session.attendance == "scheduled", Session.session_date >= now_utc()
    ).order_by(Session.session_date)).first()
    pending = db.scalars(select(HomeworkTask).where(HomeworkTask.student_id == st.id,
                                                    HomeworkTask.status == "pending")).all()
    recent = db.scalars(select(PointsEvent).where(PointsEvent.student_id == st.id)
                        .order_by(PointsEvent.created_at.desc()).limit(8)).all()
    pending_pause = db.scalar(select(PauseRequest).where(PauseRequest.student_id == st.id,
                                                         PauseRequest.status == "pending"))
    unread = db.scalar(select(func.count(Notification.id)).where(
        Notification.user_id == st.user_id, Notification.read.is_(False))) or 0
    return {
        "student": student_brief(st),
        "points": st.career_points,
        "status": st.guarantee_status,
        "thresholds": {"secured": r.secured_threshold, "suspended_below": r.suspended_below,
                       "ceiling": r.points_ceiling, "floor": r.points_floor},
        "gap_to_secure": max(0, r.secured_threshold - st.career_points),
        "week": {
            "applications": apps, "target": weekly_target(st, r), "quota_applies": quota_applies(st),
            "closes_at": iso(week_end),
            "linkedin_posts": activities_in_week(db, st.id, "linkedin_post", monday),
            "linkedin_cap": r.cap_linkedin_posts_week,
            "outreach": activities_in_week(db, st.id, "outreach", monday), "outreach_cap": r.cap_outreach_week,
            "pts_application": r.pts_application, "weekly_bonus": r.pts_weekly_bonus,
            "weekly_penalty": r.ded_weekly_target_missed,
        },
        "missed_meetings": st.missed_meetings, "max_missed_meetings": r.max_missed_meetings,
        "homework_streak": st.consecutive_homework_misses,
        "pending_homework": [homework_dict(t) for t in pending],
        "next_session": session_dict(upcoming) if upcoming else None,
        "actions": next_actions(db, st, r),
        "journey": stage_progress(db, st, weekly_target(st, r)),
        "conditions": guarantee_conditions(db, st, r),
        "recent": [event_dict(e) for e in recent],
        "deadline": deadline_info(db, st, r),
        "pause": {"active": is_paused(st), "from": st.paused_from.isoformat() if st.paused_from else None,
                  "until": st.paused_until.isoformat() if st.paused_until else None,
                  "available": max(0, r.pauses_per_cycle - st.pauses_used), "max_days": r.max_pause_days,
                  "multiplier": r.pause_deadline_multiplier,
                  "pending": pause_dict(pending_pause) if pending_pause else None},
        "unread_notifications": unread,
        "rules": {k: r[k] for k in r if k.startswith(("pts_", "ded_", "cap_"))},
    }
