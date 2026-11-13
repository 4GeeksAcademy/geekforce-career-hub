"""Automations: n8n workflows the hub can start, fire on hub events, and hear back from.

Three ways a workflow connects to the hub:
  1. "Run" button  → POST to the workflow's Webhook URL with the context (a student, a cohort, a job) + params.
  2. Hub events    → the same POST, automatically, when something happens (stage changed, job shared…).
  3. Callback      → the workflow POSTs its result to /api/v1/integrations/automations/{id}/callback
                     (header X-GeekForce-Secret), so scheduled workflows still show their runs in the hub.
An n8n connection (base URL + API key) lets the hub list workflows, read active state and recent executions.
Every call is logged in automation_runs. Network failures are recorded, never raised into the request.
"""
import logging
import secrets
import time

import httpx

from .config import settings
from .db import SessionLocal
from .models import Automation, AutomationConnection, AutomationRun
from .timeutil import now_utc

log = logging.getLogger("geekforce.automations")

# Hub events an automation can listen to. Payload always has {"event", "student", "data"}.
EVENTS = {
    "stage_changed": "Student moved to another stage",
    "status_changed": "Student status changed (hired, not to be placed…)",
    "job_shared": "A job was shared with a student",
    "job_response": "Student answered a shared job (interested, applied, not a fit)",
    "application_stage": "A shared job's application moved (phone screen, offer…)",
    "resume_approved": "Advisor approved a student's resume",
}
SCOPES = {"none": "Nothing (just start it)", "student": "A student", "cohort": "A cohort", "job": "A Job Radar job"}


def new_secret() -> str:
    return secrets.token_urlsafe(24)


def _headers(a: Automation) -> dict:
    h = {"Content-Type": "application/json", "User-Agent": "GeekForce-Career-Hub"}
    if a.secret:
        h["X-GeekForce-Secret"] = a.secret
    return h


def post_webhook(a: Automation, body: dict, transport: httpx.BaseTransport | None = None) -> dict:
    """Send one call. Returns {status, http_status, response, duration_ms}; never raises."""
    t0 = time.monotonic()
    try:
        with httpx.Client(timeout=20, transport=transport) as c:
            r = c.post(a.webhook_url, json=body, headers=_headers(a))
        ok = r.status_code < 300
        return {"status": "ok" if ok else "error", "http_status": r.status_code, "response": r.text[:2000],
                "duration_ms": int((time.monotonic() - t0) * 1000)}
    except httpx.HTTPError as e:
        return {"status": "error", "http_status": None, "response": f"{type(e).__name__}: {e}"[:2000],
                "duration_ms": int((time.monotonic() - t0) * 1000)}


def record(db, a: Automation, source: str, result: dict, *, user_id: str | None = None, event: str | None = None,
           context: dict | None = None) -> AutomationRun:
    run = AutomationRun(automation_id=a.id, source=source, status=result["status"], triggered_by=user_id, event=event,
                        context=context, http_status=result.get("http_status"), response=result.get("response"),
                        duration_ms=result.get("duration_ms"), created_at=now_utc())
    db.add(run)
    a.last_run_at, a.last_status = run.created_at, run.status
    return run


def targets_for(db, event: str) -> list[dict]:
    """Active automations listening to an event, captured inside the request (delivered after commit)."""
    from sqlalchemy import select
    out = []
    for a in db.scalars(select(Automation).where(Automation.active.is_(True), Automation.webhook_url.is_not(None))).all():
        if event in (a.events or []):
            out.append({"id": a.id})
    return out


def deliver_event(target_ids: list[str], body: dict, bind=None):
    """Runs in the background thread after commit."""
    if not target_ids:
        return
    from sqlalchemy.orm import Session as _S
    db = _S(bind=bind, expire_on_commit=False) if bind is not None else SessionLocal()
    try:
        for aid in target_ids:
            a = db.get(Automation, aid)
            if not a or not a.active or not a.webhook_url:
                continue
            res = post_webhook(a, {**body, "automation": {"id": a.id, "name": a.name}, "source": "event"})
            st = body.get("student") or {}
            record(db, a, "event", res, event=body.get("event"),
                   context={"student": {"id": st.get("id"), "name": st.get("name")}} if st else None)
        db.commit()
    except Exception:  # noqa: BLE001
        log.exception("automation event delivery failed")
        db.rollback()
    finally:
        db.close()


# ── n8n API (read-only: workflows, executions) ──

class N8nError(Exception):
    pass


def n8n_get(conn: AutomationConnection, path: str, params: dict | None = None,
            transport: httpx.BaseTransport | None = None) -> dict:
    if not conn.api_key:
        raise N8nError("This connection has no API key.")
    url = conn.base_url.rstrip("/") + "/api/v1" + path
    try:
        with httpx.Client(timeout=20, transport=transport) as c:
            r = c.get(url, params=params, headers={"X-N8N-API-KEY": conn.api_key, "Accept": "application/json"})
    except httpx.HTTPError as e:
        raise N8nError(f"Couldn't reach n8n: {e}") from e
    if r.status_code == 401:
        raise N8nError("n8n rejected the API key (401). Create a new key in n8n → Settings → n8n API.")
    if r.status_code >= 300:
        raise N8nError(f"n8n answered {r.status_code}: {r.text[:200]}")
    return r.json()


def webhook_info(conn: AutomationConnection, wf: dict) -> dict:
    """Find a workflow's trigger(s) and, when it has a Webhook node, its production URL."""
    nodes = wf.get("nodes") or []
    triggers = []
    url = None
    for n in nodes:
        t = (n.get("type") or "").split(".")[-1]
        if "trigger" in t.lower() or t in ("webhook", "cron", "scheduleTrigger"):
            triggers.append(t)
        if t == "webhook" and not url:
            path = (n.get("parameters") or {}).get("path") or n.get("webhookId")
            if path:
                url = f"{conn.base_url.rstrip('/')}/webhook/{str(path).lstrip('/')}"
    return {"triggers": sorted(set(triggers)), "webhook_url": url}


def workflow_link(conn: AutomationConnection | None, wf_id: str | None, base: str | None = None) -> str | None:
    root = (conn.base_url if conn else base or settings.n8n_base_url or "").rstrip("/")
    return f"{root}/workflow/{wf_id}" if root and wf_id else None
