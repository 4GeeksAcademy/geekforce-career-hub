"""Automations section: n8n connections, registered workflows, Run, event triggers, callbacks, run history."""
import hmac
import re

from fastapi import APIRouter, Body, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import automations as A
from ..auth import require_admin, require_staff, student_for
from ..config import settings
from ..i18n import L
from ..db import get_db
from ..events import student_payload
from ..models import AuditLog, Automation, AutomationConnection, AutomationRun, Cohort, Job, Student, User
from ..serializers import iso
from ..timeutil import now_utc

router = APIRouter(tags=["automations"])


def conn_dict(c: AutomationConnection) -> dict:
    key = c.api_key or ""
    return {"id": c.id, "name": c.name, "kind": c.kind, "base_url": c.base_url, "has_api_key": bool(key),
            "api_key_hint": f"••••{key[-4:]}" if len(key) >= 8 else None, "created_at": iso(c.created_at)}


def auto_dict(a: Automation, runs_24h: int | None = None, admin: bool = False) -> dict:
    return {"id": a.id, "name": a.name, "description": a.description, "category": a.category,
            "connection_id": a.connection_id, "n8n_workflow_id": a.n8n_workflow_id, "link": a.link,
            "webhook_url": a.webhook_url if admin else (bool(a.webhook_url) or None), "runnable": bool(a.webhook_url),
            "has_secret": bool(a.secret), "secret": a.secret if admin else None,
            "events": a.events or [], "scope": a.scope, "allow_advisors": a.allow_advisors, "active": a.active,
            "schedule_note": a.schedule_note, "last_run_at": iso(a.last_run_at), "last_status": a.last_status,
            "callback_url": f"{settings.app_url.rstrip('/')}/api/v1/integrations/automations/{a.id}/callback",
            "runs_24h": runs_24h, "created_at": iso(a.created_at)}


def run_dict(r: AutomationRun, names: dict[str, str]) -> dict:
    return {"id": r.id, "automation_id": r.automation_id, "source": r.source, "status": r.status, "event": r.event,
            "context": r.context, "http_status": r.http_status, "response": r.response, "duration_ms": r.duration_ms,
            "triggered_by": names.get(r.triggered_by) if r.triggered_by else None, "created_at": iso(r.created_at)}


def _url_ok(u: str | None) -> str | None:
    u = (u or "").strip()
    if not u:
        return None
    if not re.match(r"^https?://[^\s/]+", u):
        raise HTTPException(422, "Use a full URL that starts with https://")
    return u


# ── connections (admin) ──

class ConnIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    base_url: str
    api_key: str | None = None


@router.get("/automations/connections")
def list_connections(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return [conn_dict(c) for c in db.scalars(select(AutomationConnection).order_by(AutomationConnection.name))]


@router.post("/automations/connections", status_code=201)
def create_connection(body: ConnIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    c = AutomationConnection(name=body.name.strip(), base_url=_url_ok(body.base_url).rstrip("/"),
                             api_key=(body.api_key or "").strip() or None, created_by=user.id)
    db.add(c)
    db.add(AuditLog(actor_id=user.id, action="automation_connection_added", detail=c.name))
    db.commit()
    return conn_dict(c)


class ConnPatch(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None  # "" removes it


@router.patch("/automations/connections/{cid}")
def update_connection(cid: str, body: ConnPatch, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    c = db.get(AutomationConnection, cid) or _404()
    d = body.model_dump(exclude_unset=True)
    if d.get("name"):
        c.name = d["name"].strip()
    if d.get("base_url"):
        c.base_url = _url_ok(d["base_url"]).rstrip("/")
    if "api_key" in d and d["api_key"] is not None:
        c.api_key = d["api_key"].strip() or None
    db.commit()
    return conn_dict(c)


@router.delete("/automations/connections/{cid}")
def delete_connection(cid: str, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    c = db.get(AutomationConnection, cid) or _404()
    for a in db.scalars(select(Automation).where(Automation.connection_id == c.id)):
        a.connection_id = None
    db.delete(c)
    db.add(AuditLog(actor_id=user.id, action="automation_connection_removed", detail=c.name))
    db.commit()
    return {"ok": True}


@router.post("/automations/connections/{cid}/test")
def test_connection(cid: str, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    c = db.get(AutomationConnection, cid) or _404()
    try:
        data = A.n8n_get(c, "/workflows", {"limit": 1})
    except A.N8nError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "message": "Connected to n8n", "sample": len(data.get("data") or [])}


@router.get("/automations/connections/{cid}/workflows")
def connection_workflows(cid: str, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """The workflows n8n has, marked when already registered in the hub."""
    c = db.get(AutomationConnection, cid) or _404()
    out, cursor = [], None
    try:
        for _ in range(10):
            page = A.n8n_get(c, "/workflows", {"limit": 100, **({"cursor": cursor} if cursor else {})})
            out += page.get("data") or []
            cursor = page.get("nextCursor")
            if not cursor:
                break
    except A.N8nError as e:
        raise HTTPException(502, str(e))
    known = {a.n8n_workflow_id: a.id for a in db.scalars(select(Automation).where(Automation.n8n_workflow_id.is_not(None)))}
    items = []
    for wf in out:
        info = A.webhook_info(c, wf)
        items.append({"id": wf.get("id"), "name": wf.get("name"), "active": wf.get("active"),
                      "updated_at": wf.get("updatedAt"), "tags": [t.get("name") for t in wf.get("tags") or []],
                      "triggers": info["triggers"], "webhook_url": info["webhook_url"],
                      "link": A.workflow_link(c, wf.get("id")), "automation_id": known.get(wf.get("id"))})
    return sorted(items, key=lambda w: (w["automation_id"] is None, (w["name"] or "").lower()))


@router.post("/automations/connections/{cid}/sync")
def sync_connection(cid: str, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Fill in webhook URLs and active state for registered workflows from n8n."""
    c = db.get(AutomationConnection, cid) or _404()
    updated = 0
    for a in db.scalars(select(Automation).where(Automation.n8n_workflow_id.is_not(None))):
        try:
            wf = A.n8n_get(c, f"/workflows/{a.n8n_workflow_id}")
        except A.N8nError:
            continue
        info = A.webhook_info(c, wf)
        a.connection_id = c.id
        if info["webhook_url"] and not a.webhook_url:
            a.webhook_url = info["webhook_url"]
        a.link = A.workflow_link(c, a.n8n_workflow_id)
        a.schedule_note = a.schedule_note or (", ".join(info["triggers"]) or None)
        updated += 1
    db.commit()
    return {"ok": True, "updated": updated}


# ── automations ──

class AutoIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    description: str | None = None
    category: str | None = None
    connection_id: str | None = None
    n8n_workflow_id: str | None = None
    link: str | None = None
    webhook_url: str | None = None
    events: list[str] = []
    scope: str = "none"
    allow_advisors: bool = True
    active: bool = True
    schedule_note: str | None = None


def _clean(a: Automation, d: dict, db: Session):
    for k in ("name", "description", "category", "schedule_note", "n8n_workflow_id"):
        if k in d:
            v = (d[k] or "").strip()
            if k == "name" and not v:
                raise HTTPException(422, "Give it a name")
            setattr(a, k, v or None)
    if "connection_id" in d:
        if d["connection_id"] and not db.get(AutomationConnection, d["connection_id"]):
            raise HTTPException(422, "Unknown connection")
        a.connection_id = d["connection_id"] or None
    if "link" in d:
        a.link = _url_ok(d["link"])
    if "webhook_url" in d:
        a.webhook_url = _url_ok(d["webhook_url"])
    if "events" in d:
        bad = [e for e in d["events"] if e not in A.EVENTS]
        if bad:
            raise HTTPException(422, f"Unknown event: {', '.join(bad)}")
        a.events = list(dict.fromkeys(d["events"]))
    if "scope" in d:
        if d["scope"] not in A.SCOPES:
            raise HTTPException(422, "Unknown scope")
        a.scope = d["scope"]
    for k in ("allow_advisors", "active"):
        if k in d and d[k] is not None:
            setattr(a, k, d[k])
    if not a.link and a.n8n_workflow_id:
        conn = db.get(AutomationConnection, a.connection_id) if a.connection_id else None
        a.link = A.workflow_link(conn, a.n8n_workflow_id)


@router.get("/automations/meta")
def meta(user: User = Depends(require_staff)):
    return {"events": A.EVENTS, "scopes": A.SCOPES,
            "ingest_url": f"{settings.app_url.rstrip('/')}/api/v1/integrations/jobs",
            "ingest_ready": bool(settings.jobs_ingest_secret)}


@router.get("/automations")
def list_automations(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    q = select(Automation).order_by(Automation.category.nulls_last(), Automation.name)
    if user.role != "admin":
        q = q.where(Automation.allow_advisors.is_(True))
    rows = db.scalars(q).all()
    since = now_utc().replace(microsecond=0)
    from datetime import timedelta
    counts = dict(db.execute(select(AutomationRun.automation_id, func.count()).where(
        AutomationRun.created_at >= since - timedelta(hours=24)).group_by(AutomationRun.automation_id)).all())
    return [auto_dict(a, counts.get(a.id, 0), admin=user.role == "admin") for a in rows]


@router.post("/automations", status_code=201)
def create_automation(body: AutoIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    a = Automation(name=body.name.strip(), created_by=user.id, secret=A.new_secret(), events=[], scope="none")
    _clean(a, body.model_dump(), db)
    db.add(a)
    db.add(AuditLog(actor_id=user.id, action="automation_added", detail=a.name))
    db.commit()
    return auto_dict(a, 0, admin=True)


@router.patch("/automations/{aid}")
def update_automation(aid: str, body: dict = Body(...), user: User = Depends(require_admin), db: Session = Depends(get_db)):
    a = db.get(Automation, aid) or _404()
    allowed = set(AutoIn.model_fields)
    _clean(a, {k: v for k, v in body.items() if k in allowed}, db)
    if body.get("rotate_secret"):
        a.secret = A.new_secret()
    db.commit()
    return auto_dict(a, admin=True)


@router.delete("/automations/{aid}")
def delete_automation(aid: str, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    a = db.get(Automation, aid) or _404()
    db.add(AuditLog(actor_id=user.id, action="automation_removed", detail=a.name))
    db.delete(a)
    db.commit()
    return {"ok": True}


class RunIn(BaseModel):
    student_id: str | None = None
    cohort_id: str | None = None
    job_id: str | None = None
    params: dict = {}
    test: bool = False


def _context(db: Session, user: User, a: Automation, body: RunIn) -> dict:
    ctx: dict = {}
    if body.student_id:
        st = student_for(db, user, body.student_id)
        ctx["student"] = student_payload(st)
    if body.cohort_id:
        co = db.get(Cohort, body.cohort_id) or _404()
        q = select(Student).where(Student.cohort_id == co.id)
        if user.role != "admin":
            q = q.where(Student.advisor_id == user.id)
        ctx["cohort"] = {"id": co.id, "name": co.name, "program": co.program,
                         "students": [student_payload(s) for s in db.scalars(q)]}
    if body.job_id:
        j = db.get(Job, body.job_id) or _404()
        ctx["job"] = {"id": j.id, "title": j.title, "company": j.company, "location": j.location, "country": j.country,
                      "url": j.url, "program": j.program, "source": j.source}
    need = a.scope
    if need != "none" and need not in ctx and not body.test:
        raise HTTPException(422, L("Choose a {thing} to run this with.", thing=L(A.SCOPES[need]).lower()))
    return ctx


@router.post("/automations/{aid}/run")
def run_automation(aid: str, body: RunIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    a = db.get(Automation, aid) or _404()
    if user.role != "admin" and not a.allow_advisors:
        raise HTTPException(403, "Only admins can run this automation")
    if not a.webhook_url:
        raise HTTPException(422, "This workflow has no Webhook URL yet. Add a Webhook trigger in n8n and paste its "
                                 "production URL here (or sync it from the n8n connection).")
    if not a.active and not body.test:
        raise HTTPException(422, "This automation is paused")
    ctx = _context(db, user, a, body)
    payload = {"event": "manual_run", "source": "test" if body.test else "manual",
               "automation": {"id": a.id, "name": a.name}, "triggered_by": {"id": user.id, "name": user.name,
                                                                         "email": user.email},
               "params": body.params or {}, **ctx,
               "callback_url": f"{settings.app_url.rstrip('/')}/api/v1/integrations/automations/{a.id}/callback",
               "sent_at": iso(now_utc())}
    res = A.post_webhook(a, payload)
    brief = {k: ({"id": v.get("id"), "name": v.get("name") or v.get("title")} if isinstance(v, dict) else v)
             for k, v in ctx.items()}
    if body.params:
        brief["params"] = body.params
    run = A.record(db, a, "test" if body.test else "manual", res, user_id=user.id, context=brief or None)
    db.commit()
    names = {user.id: user.name}
    return run_dict(run, names)


@router.get("/automations/runs")
def runs(automation_id: str | None = None, status: str | None = None, limit: int = 100,
         user: User = Depends(require_staff), db: Session = Depends(get_db)):
    q = select(AutomationRun).order_by(AutomationRun.created_at.desc()).limit(max(1, min(limit, 500)))
    if automation_id:
        q = q.where(AutomationRun.automation_id == automation_id)
    if status:
        q = q.where(AutomationRun.status == status)
    if user.role != "admin":
        q = q.join(Automation, Automation.id == AutomationRun.automation_id).where(Automation.allow_advisors.is_(True))
    rows = db.scalars(q).all()
    ids = {r.triggered_by for r in rows if r.triggered_by}
    names = {u.id: u.name for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}
    return [run_dict(r, names) for r in rows]


@router.get("/automations/{aid}/executions")
def executions(aid: str, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    """Recent n8n executions for this workflow (needs an n8n connection with an API key)."""
    a = db.get(Automation, aid) or _404()
    conn = db.get(AutomationConnection, a.connection_id) if a.connection_id else None
    if not conn or not a.n8n_workflow_id:
        return {"connected": False, "items": []}
    try:
        data = A.n8n_get(conn, "/executions", {"workflowId": a.n8n_workflow_id, "limit": 20})
    except A.N8nError as e:
        return {"connected": True, "error": str(e), "items": []}
    items = [{"id": e.get("id"), "status": e.get("status") or ("success" if e.get("finished") else "running"),
              "mode": e.get("mode"), "started_at": e.get("startedAt"), "stopped_at": e.get("stoppedAt"),
              "link": f"{conn.base_url.rstrip('/')}/workflow/{a.n8n_workflow_id}/executions/{e.get('id')}"}
             for e in data.get("data") or []]
    return {"connected": True, "items": items}


# ── inbound: the workflow reports back ──

@router.post("/integrations/automations/{aid}/callback")
def callback(aid: str, body: dict = Body(default={}), x_geekforce_secret: str = Header(default=""),
             db: Session = Depends(get_db)):
    """A workflow tells the hub it ran. Body: {"status": "ok"|"error", "message": "...", "items": 12, ...anything}."""
    a = db.get(Automation, aid)
    if not a or not a.secret or not hmac.compare_digest(x_geekforce_secret or "", a.secret):
        raise HTTPException(401, "Bad secret")
    status = "error" if str(body.get("status", "ok")).lower() in ("error", "failed", "fail") else "ok"
    msg = body.get("message") or body.get("summary")
    import json
    res = {"status": status, "http_status": None, "duration_ms": body.get("duration_ms"),
           "response": (str(msg) if msg else json.dumps(body, default=str))[:2000]}
    ctx = {k: body[k] for k in ("items", "jobs", "count", "country", "execution_id") if k in body} or None
    A.record(db, a, "callback", res, context=ctx)
    db.commit()
    return {"ok": True}


def _404():
    raise HTTPException(404, "Not found")
