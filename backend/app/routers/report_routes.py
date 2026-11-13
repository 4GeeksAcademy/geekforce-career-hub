"""Dashboards: saved sets of widgets over the report engine, with dashboard-wide filters."""
from datetime import timedelta

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import reports as R
from ..auth import require_staff
from ..db import get_db
from ..i18n import lang_of, tr
from ..models import Dashboard, DashboardWidget, User
from ..serializers import iso
from ..timeutil import local_today

router = APIRouter(tags=["reports"])


def widget_dict(w: DashboardWidget) -> dict:
    return {"id": w.id, "title": w.title, "config": w.config or {}, "position": w.position, "width": w.width}


def dash_dict(d: Dashboard, user: User, widgets: bool = False) -> dict:
    out = {"id": d.id, "name": d.name, "description": d.description, "shared": d.shared, "filters": d.filters or {},
           "owner_id": d.owner_id, "mine": d.owner_id == user.id,
           "can_edit": d.owner_id == user.id or user.role == "admin", "updated_at": iso(d.updated_at)}
    if widgets:
        out["widgets"] = [widget_dict(w) for w in sorted(d.widgets, key=lambda w: (w.position, w.created_at))]
    return out


def _spec(cfg: dict, dash_filters: dict | None) -> dict:
    """Combine a widget's own question with the dashboard-wide filters (dashboard wins on the same dimension)."""
    spec = {k: cfg.get(k) for k in ("dataset", "metric", "group_by", "split_by", "limit")}
    f = dict(cfg.get("filters") or {})
    df = dict(dash_filters or {})
    date_from, date_to = df.pop("date_from", None), df.pop("date_to", None)
    for k, v in df.items():
        if v not in (None, "", []):
            f[k] = v
    if not date_from and cfg.get("range_days"):
        date_from = (local_today() - timedelta(days=int(cfg["range_days"]))).isoformat()
    spec.update({"filters": f, "date_from": date_from or cfg.get("date_from"), "date_to": date_to or cfg.get("date_to")})
    return spec


def _get(db: Session, user: User, did: str, edit: bool = False) -> Dashboard:
    d = db.get(Dashboard, did)
    if not d or (d.owner_id != user.id and not d.shared and user.role != "admin"):
        raise HTTPException(404, "Not found")
    if edit and d.owner_id != user.id and user.role != "admin":
        raise HTTPException(403, "Only the owner can change this dashboard. Duplicate it to make your own.")
    return d


def _seed_default(db: Session, user: User) -> Dashboard:
    lang = lang_of(user)
    d = Dashboard(name=tr(R.DEFAULT_DASHBOARD["name"], lang), description=tr(R.DEFAULT_DASHBOARD["description"], lang), owner_id=user.id,
                  shared=False, filters={}, position=0)
    db.add(d)
    db.flush()
    for i, w in enumerate(R.DEFAULT_DASHBOARD["widgets"]):
        db.add(DashboardWidget(dashboard_id=d.id, title=tr(w["title"], lang), config=w["config"], width=w["width"], position=i))
    return d


@router.get("/reports/schema")
def schema(user: User = Depends(require_staff)):
    return {"datasets": R.schema(), "buckets": list(R.BUCKETS)}


@router.post("/reports/query")
def query(body: dict = Body(...), user: User = Depends(require_staff), db: Session = Depends(get_db)):
    cfg = body.get("config") or body
    try:
        return R.run(db, user, _spec(cfg, body.get("dashboard_filters")))
    except R.ReportError as e:
        raise HTTPException(422, str(e))


@router.get("/reports/values")
def values(dataset: str, dim: str, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    try:
        return R.values(db, user, dataset, dim)
    except R.ReportError as e:
        raise HTTPException(422, str(e))


@router.get("/dashboards")
def list_dashboards(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    rows = db.scalars(select(Dashboard).where(or_(Dashboard.owner_id == user.id, Dashboard.shared.is_(True)))
                      .order_by(Dashboard.position, Dashboard.created_at)).all()
    if not any(d.owner_id == user.id for d in rows):
        rows = [_seed_default(db, user), *rows]
        db.commit()
    return [dash_dict(d, user) for d in rows]


class DashIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None
    shared: bool = False
    copy_from: str | None = None


@router.post("/dashboards", status_code=201)
def create_dashboard(body: DashIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    d = Dashboard(name=body.name.strip(), description=body.description, owner_id=user.id, shared=body.shared,
                  filters={}, position=99)
    db.add(d)
    db.flush()
    if body.copy_from:
        src = _get(db, user, body.copy_from)
        d.filters = dict(src.filters or {})
        for w in src.widgets:
            db.add(DashboardWidget(dashboard_id=d.id, title=w.title, config=dict(w.config or {}), width=w.width,
                                   position=w.position))
    db.commit()
    db.refresh(d)
    return dash_dict(d, user, widgets=True)


@router.get("/dashboards/{did}")
def get_dashboard(did: str, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    return dash_dict(_get(db, user, did), user, widgets=True)


@router.patch("/dashboards/{did}")
def update_dashboard(did: str, body: dict = Body(...), user: User = Depends(require_staff), db: Session = Depends(get_db)):
    d = _get(db, user, did, edit=True)
    if "name" in body and str(body["name"]).strip():
        d.name = str(body["name"]).strip()[:160]
    if "description" in body:
        d.description = body["description"] or None
    if "shared" in body:
        d.shared = bool(body["shared"])
    if "filters" in body and isinstance(body["filters"], dict):
        d.filters = {k: v for k, v in body["filters"].items() if v not in (None, "", [])}
    if "order" in body and isinstance(body["order"], list):
        pos = {wid: i for i, wid in enumerate(body["order"])}
        for w in d.widgets:
            w.position = pos.get(w.id, w.position)
    db.commit()
    db.refresh(d)
    return dash_dict(d, user, widgets=True)


@router.delete("/dashboards/{did}")
def delete_dashboard(did: str, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    d = _get(db, user, did, edit=True)
    db.delete(d)
    db.commit()
    return {"ok": True}


class WidgetIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    config: dict
    width: int = 2


def _check(cfg: dict):
    if cfg.get("dataset") not in R.DATASETS:
        raise HTTPException(422, "Choose what to count")
    if cfg.get("chart") not in ("number", "bar", "stacked", "line", "table"):
        raise HTTPException(422, "Choose a chart type")


@router.post("/dashboards/{did}/widgets", status_code=201)
def add_widget(did: str, body: WidgetIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    d = _get(db, user, did, edit=True)
    _check(body.config)
    w = DashboardWidget(dashboard_id=d.id, title=body.title.strip(), config=body.config,
                        width=max(1, min(body.width, 4)), position=len(d.widgets))
    db.add(w)
    db.commit()
    return widget_dict(w)


@router.patch("/dashboards/{did}/widgets/{wid}")
def update_widget(did: str, wid: str, body: WidgetIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    d = _get(db, user, did, edit=True)
    w = db.get(DashboardWidget, wid)
    if not w or w.dashboard_id != d.id:
        raise HTTPException(404, "Not found")
    _check(body.config)
    w.title, w.config, w.width = body.title.strip(), body.config, max(1, min(body.width, 4))
    db.commit()
    return widget_dict(w)


@router.delete("/dashboards/{did}/widgets/{wid}")
def delete_widget(did: str, wid: str, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    d = _get(db, user, did, edit=True)
    w = db.get(DashboardWidget, wid)
    if not w or w.dashboard_id != d.id:
        raise HTTPException(404, "Not found")
    db.delete(w)
    db.commit()
    return {"ok": True}
