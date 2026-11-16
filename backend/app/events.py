"""Outbound events for automations.

Every important change (stage moved, student status changed, guarantee status changed) is queued on the DB session
and, after the transaction commits, sent in a background thread to:
  1. ActiveCampaign — exclusive stage/status tags + fields, so AC automations can start the next actions;
  2. AUTOMATION_WEBHOOK_URL (an n8n Webhook node) — JSON body, header X-GeekForce-Secret, for anything else
     (Slack alerts, Notion write-back, calendar invites…).
Failures are logged and never break the request.
"""
import logging
from concurrent.futures import ThreadPoolExecutor

import httpx
from sqlalchemy import event
from sqlalchemy.orm import Session

from .config import settings
from .i18n import lang_of

log = logging.getLogger("geekforce.events")
_pool = ThreadPoolExecutor(max_workers=2)


def student_payload(st) -> dict:
    return {"id": st.id, "name": st.user.name, "email": st.user.email, "stage": st.stage, "status": st.status,
            "guarantee_status": st.guarantee_status, "points": st.career_points,
            "enrollment_plan": st.enrollment_plan, "advisor": st.advisor.name if st.advisor else None,
            "advisor_email": st.advisor.email if st.advisor else None,
            "cohort": st.cohort.name if st.cohort else None, "program": st.cohort.program if st.cohort else None,
            "notion_page_id": st.notion_page_id, "language": lang_of(st.user),
            "hub_url": f"{settings.app_url.rstrip('/')}/staff/students/{st.id}"}


# Events that also go to ActiveCampaign and the global webhook (student lifecycle). Others only reach automations.
LIFECYCLE = {"stage_changed", "status_changed"}


def emit(db: Session, name: str, st, data: dict | None = None):
    from .services import activecampaign as ac
    from . import automations as A
    item = {"event": name, "student": student_payload(st), "data": data or {}}
    if name in LIFECYCLE:
        item.update({"ac_fields": ac.student_fields(st), "ac_status": ac.status_key(st)})
    try:
        item["_automations"] = [t["id"] for t in A.targets_for(db, name)]
    except Exception:  # noqa: BLE001  (table missing in an old DB, etc.)
        item["_automations"] = []
    item["_bind"] = db.get_bind()
    db.info.setdefault("pending_events", []).append(item)


def _deliver(items: list[dict]):
    from .services import activecampaign as ac
    from . import automations as A
    for it in items:
        st = it["student"]
        targets, bind = it.pop("_automations", []), it.pop("_bind", None)
        if targets:
            A.deliver_event(targets, {k: v for k, v in it.items() if not k.startswith("ac_")}, bind)
        if "ac_status" not in it:
            continue
        if ac.configured():
            ac.push_state(st["email"], st["name"], it["ac_fields"], it["ac_status"], st["stage"])
        if settings.automation_webhook_url:
            try:
                r = httpx.post(settings.automation_webhook_url, json={k: v for k, v in it.items() if not k.startswith("ac_")},
                               headers={"X-GeekForce-Secret": settings.automation_webhook_secret}, timeout=15)
                if r.status_code >= 300:
                    log.warning("automation webhook %s → %s %s", it["event"], r.status_code, r.text[:200])
            except httpx.HTTPError as e:
                log.warning("automation webhook failed for %s: %s", it["event"], e)


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session):
    items = session.info.pop("pending_events", None)
    if items:
        if session.info.get("sync_email"):
            _deliver(items)
        else:
            _pool.submit(_deliver, items)


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session):
    session.info.pop("pending_events", None)
