"""In-app notifications + email via Brevo.

Guarantee-related notifications are locked (students cannot opt out). Emails are queued on the DB session
and sent only after the transaction commits, in a background thread.
"""
import logging
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from .models import Notification, NotificationPreference, Student, User
from .services.brevo import send_email

log = logging.getLogger("geekforce.notify")
_pool = ThreadPoolExecutor(max_workers=4)

# Preference keys students can turn off. Everything else is locked on.
OPTIONAL = {
    "session_notes": "Session notes and new homework",
    "homework_reminder": "Homework due in 48 hours",
    "weekly_nudge": "Friday nudge if under the weekly target",
    "session_scheduled": "GeekForce sessions scheduled",
    "job_match": "Job matches from my advisor",
}
LOCKED = {
    "guarantee": "Guarantee status changes",
    "deduction": "Point deductions",
    "inactivity": "Inactivity and pause updates",
    "missed_meetings": "Missed-meeting limit",
}


def preference_enabled(db: Session, user_id: str, key: str) -> bool:
    if key not in OPTIONAL:
        return True
    pref = db.scalar(select(NotificationPreference).where(
        NotificationPreference.user_id == user_id, NotificationPreference.key == key))
    return True if pref is None else pref.enabled


def notify_user(db: Session, user: User, *, type: str, category: str, title: str, body: str,
                pref_key: str = "guarantee", email: bool = True, link: str | None = None) -> Notification | None:
    if not preference_enabled(db, user.id, pref_key):
        return None
    n = Notification(user_id=user.id, type=type, category=category, title=title, body=body, link=link)
    db.add(n)
    if email:
        db.info.setdefault("pending_emails", []).append(
            (n, user.email, user.name, title, body, type, link))
    return n


def notify_student(db: Session, student: Student, **kw) -> Notification | None:
    return notify_user(db, student.user, **kw)


def alert_advisor(db: Session, student: Student, title: str, body: str, link: str | None = None):
    if student.advisor:
        notify_user(db, student.advisor, type="critical", category="advisor_alert",
                    title=title, body=body, link=link or f"/staff/students/{student.id}")


def _send(items):
    from .db import SessionLocal
    sent_ids = []
    for n, to, name, title, body, kind, link in items:
        if send_email(to, name, title, title, body, kind, link):
            sent_ids.append(n.id)
    if sent_ids:
        with SessionLocal() as s:
            for nid in sent_ids:
                row = s.get(Notification, nid)
                if row:
                    row.email_sent = True
            s.commit()


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session):
    items = session.info.pop("pending_emails", None)
    if items:
        if session.info.get("sync_email"):
            _send(items)
        else:
            _pool.submit(_send, items)


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session):
    session.info.pop("pending_emails", None)
