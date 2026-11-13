"""Report engine behind Dashboards.

A widget asks one question: a dataset, a metric, optional "group by" and "split by" dimensions (or a time bucket),
and filters. Every dataset that belongs to students can be filtered by the same student dimensions (advisor, cohort,
program, stage…), so dashboard-wide filters combine across widgets. Advisors only ever see their own students.
"""
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import Numeric, and_, case, cast, distinct, func, literal, select
from sqlalchemy.orm import aliased

from .models import Application, Cohort, Job, JobShare, PointsEvent, Session as SessionModel, Student, User

Advisor = aliased(User, name="advisor_u")
StudentUser = aliased(User, name="student_u")

# Dimensions every student-based dataset shares.
STUDENT_DIMS = {
    "advisor": ("Advisor", func.coalesce(Advisor.name, literal("No advisor"))),
    "cohort": ("Cohort", func.coalesce(Cohort.name, literal("No cohort"))),
    "program": ("Program", func.coalesce(Cohort.program, literal("—"))),
    "region": ("Region", func.coalesce(Cohort.region, literal("—"))),
    "stage": ("Stage", func.coalesce(Student.stage, literal("not_started"))),
    "student_status": ("Student status", Student.status),
    "guarantee": ("Job guarantee", Student.guarantee_status),
    "plan": ("Enrollment plan", func.coalesce(Student.enrollment_plan, literal("—"))),
    "student_country": ("Student country", func.coalesce(Student.country, literal("—"))),
}


def _student_joins(q, student_id_col=None):
    if student_id_col is not None:
        q = q.join(Student, Student.id == student_id_col)
    return (q.join(StudentUser, StudentUser.id == Student.user_id)
             .outerjoin(Cohort, Cohort.id == Student.cohort_id)
             .outerjoin(Advisor, Advisor.id == Student.advisor_id))


DATASETS = {
    "students": {
        "label": "Students", "base": Student, "time": Student.created_at, "time_label": "Joined",
        "join": lambda q: _student_joins(q),
        "dims": {**STUDENT_DIMS,
                 "points_band": ("Points band", case((Student.career_points >= 80, literal("80+")),
                                                     (Student.career_points >= 60, literal("60–79")),
                                                     (Student.career_points >= 40, literal("40–59")),
                                                     else_=literal("Under 40")))},
        "metrics": {"count": ("Students", func.count(distinct(Student.id))),
                    "avg_points": ("Average points", func.round(cast(func.avg(Student.career_points), Numeric), 1)),
                    "on_hold": ("On hold", func.sum(case((Student.on_hold.is_(True), 1), else_=0)))},
    },
    "applications": {
        "label": "Applications", "base": Application, "time": Application.applied_at, "time_label": "Applied",
        "join": lambda q: _student_joins(q, Application.student_id),
        "dims": {**STUDENT_DIMS, "app_status": ("Application status", Application.status),
                 "app_source": ("Logged from", Application.source), "company": ("Company", Application.company)},
        "metrics": {"count": ("Applications", func.count(Application.id)),
                    "students": ("Students applying", func.count(distinct(Application.student_id))),
                    "interviews": ("Interviews or better", func.sum(case((Application.status.in_(
                        ("phone_screen", "interview", "technical", "final", "offer", "accepted", "interviewing")), 1), else_=0))),
                    "offers": ("Offers", func.sum(case((Application.status.in_(("offer", "accepted")), 1), else_=0)))},
    },
    "points": {
        "label": "Career points", "base": PointsEvent, "time": PointsEvent.created_at, "time_label": "When",
        "join": lambda q: _student_joins(q, PointsEvent.student_id),
        "dims": {**STUDENT_DIMS, "event_type": ("Rule", PointsEvent.event_type), "points_source": ("Source", PointsEvent.source),
                 "direction": ("Gained or lost", case((PointsEvent.applied_delta > 0, literal("Gained")),
                                                      (PointsEvent.applied_delta < 0, literal("Lost")), else_=literal("No change")))},
        "metrics": {"net": ("Net points", func.coalesce(func.sum(PointsEvent.applied_delta), 0)),
                    "gained": ("Points gained", func.coalesce(func.sum(case((PointsEvent.applied_delta > 0, PointsEvent.applied_delta), else_=0)), 0)),
                    "lost": ("Points lost", func.coalesce(-func.sum(case((PointsEvent.applied_delta < 0, PointsEvent.applied_delta), else_=0)), 0)),
                    "count": ("Point events", func.count(PointsEvent.id))},
    },
    "sessions": {
        "label": "Sessions", "base": SessionModel, "time": SessionModel.session_date, "time_label": "Session date",
        "join": lambda q: _student_joins(q, SessionModel.student_id),
        "dims": {**STUDENT_DIMS, "session_type": ("Session type", SessionModel.session_type),
                 "attendance": ("Attendance", SessionModel.attendance)},
        "metrics": {"count": ("Sessions", func.count(SessionModel.id)),
                    "attended": ("Attended", func.sum(case((SessionModel.attendance == "attended", 1), else_=0))),
                    "absent": ("Absent", func.sum(case((SessionModel.attendance == "absent", 1), else_=0))),
                    "students": ("Students", func.count(distinct(SessionModel.student_id)))},
    },
    "job_shares": {
        "label": "Shared jobs", "base": JobShare, "time": JobShare.created_at, "time_label": "Shared",
        "join": lambda q: _student_joins(q, JobShare.student_id).join(Job, Job.id == JobShare.job_id),
        "dims": {**STUDENT_DIMS, "share_status": ("Student answer", JobShare.status),
                 "job_country": ("Job country", func.coalesce(Job.country, literal("—"))),
                 "job_program": ("Job program", func.coalesce(Job.program, literal("—"))),
                 "job_source": ("Job source", Job.source), "job_company": ("Job company", func.coalesce(Job.company, literal("—")))},
        "metrics": {"count": ("Jobs shared", func.count(JobShare.id)),
                    "applied": ("Applied", func.sum(case((JobShare.status == "applied", 1), else_=0))),
                    "answered": ("Answered", func.sum(case((JobShare.status != "new", 1), else_=0))),
                    "students": ("Students reached", func.count(distinct(JobShare.student_id)))},
    },
    "jobs": {
        "label": "Job Radar jobs", "base": Job, "time": Job.created_at, "time_label": "Found", "student_scoped": False,
        "join": lambda q: q,
        "dims": {"job_country": ("Country", func.coalesce(Job.country, literal("—"))),
                 "job_program": ("Program", func.coalesce(Job.program, literal("—"))),
                 "job_source": ("Source", Job.source), "work_mode": ("Work mode", func.coalesce(Job.work_mode, literal("—"))),
                 "outreach": ("Outreach", Job.outreach_status),
                 "partner": ("Partner", case((Job.is_partner.is_(True), literal("Partner")), else_=literal("Not partner"))),
                 "job_company": ("Company", func.coalesce(Job.company, literal("—")))},
        "metrics": {"count": ("Jobs", func.count(Job.id)),
                    "shared": ("Times shared", func.coalesce(func.sum(Job.shared_count), 0)),
                    "partner": ("Partner jobs", func.sum(case((Job.is_partner.is_(True), 1), else_=0)))},
    },
}
BUCKETS = ("day", "week", "month")


class ReportError(ValueError):
    pass


def schema() -> dict:
    return {k: {"label": d["label"], "time_label": d["time_label"], "student_scoped": d.get("student_scoped", True),
                "dimensions": {n: v[0] for n, v in d["dims"].items()},
                "metrics": {n: v[0] for n, v in d["metrics"].items()}}
            for k, d in DATASETS.items()}


def _dim(ds: dict, name: str | None, bucket_col):
    if not name:
        return None
    if name.startswith("time:"):
        b = name.split(":", 1)[1]
        if b not in BUCKETS:
            raise ReportError(f"Unknown time bucket {b}")
        return func.to_char(func.date_trunc(b, bucket_col), "YYYY-MM-DD")
    if name not in ds["dims"]:
        raise ReportError(f"Unknown dimension {name}")
    return ds["dims"][name][1]


def _day(v, end=False):
    if not v:
        return None
    d = date.fromisoformat(str(v)[:10])
    return datetime.combine(d + timedelta(days=1) if end else d, time.min, tzinfo=timezone.utc)


def run(db, user, spec: dict) -> dict:
    """spec: {dataset, metric, group_by?, split_by?, filters?: {dim: [values]}, date_from?, date_to?, limit?, sort?}"""
    ds = DATASETS.get(spec.get("dataset") or "")
    if not ds:
        raise ReportError("Unknown dataset")
    metric_name = spec.get("metric") or "count"
    if metric_name not in ds["metrics"]:
        raise ReportError(f"Unknown metric {metric_name}")
    mlabel, metric = ds["metrics"][metric_name]
    g = _dim(ds, spec.get("group_by"), ds["time"])
    s = _dim(ds, spec.get("split_by"), ds["time"])
    cols = [c.label(n) for c, n in ((g, "x"), (s, "series")) if c is not None]
    q = ds["join"](select(*cols, metric.label("value")).select_from(ds["base"]))
    conds = []
    if ds.get("student_scoped", True) and user.role != "admin":
        conds.append(Student.advisor_id == user.id)
    for name, values in (spec.get("filters") or {}).items():
        if values in (None, "", []):
            continue
        if name not in ds["dims"]:
            continue  # a dashboard-wide filter that doesn't apply to this dataset
        values = values if isinstance(values, list) else [values]
        conds.append(ds["dims"][name][1].in_([str(v) for v in values]))
    if spec.get("date_from"):
        conds.append(ds["time"] >= _day(spec["date_from"]))
    if spec.get("date_to"):
        conds.append(ds["time"] < _day(spec["date_to"], end=True))
    if conds:
        q = q.where(and_(*conds))
    groups = [c for c in (g, s) if c is not None]
    if groups:
        q = q.group_by(*groups)
    time_x = (spec.get("group_by") or "").startswith("time:")
    if g is not None:
        q = q.order_by(g if time_x else metric.desc())
    limit = max(1, min(int(spec.get("limit") or 50), 500))
    rows = [dict(r._mapping) for r in db.execute(q.limit(limit * (12 if s is not None else 1)))]
    for r in rows:
        v = r.get("value")
        r["value"] = float(v) if v is not None and not isinstance(v, int) else (v or 0)
        if isinstance(r["value"], float) and r["value"].is_integer():
            r["value"] = int(r["value"])
    if s is not None and g is not None and not time_x:
        # keep the top N x values by total
        tot: dict = {}
        for r in rows:
            tot[r["x"]] = tot.get(r["x"], 0) + (r["value"] or 0)
        keep = set(sorted(tot, key=lambda k: -tot[k])[:limit])
        rows = [r for r in rows if r["x"] in keep]
    elif g is not None:
        rows = rows[:limit] if not time_x else rows
    total = None
    if g is None and s is None:
        total = rows[0]["value"] if rows else 0
    return {"metric": metric_name, "metric_label": mlabel, "rows": rows, "total": total,
            "group_by": spec.get("group_by"), "split_by": spec.get("split_by")}


def values(db, user, dataset: str, dim: str, limit: int = 200) -> list[str]:
    ds = DATASETS.get(dataset)
    if not ds or dim not in ds["dims"]:
        raise ReportError("Unknown dimension")
    col = ds["dims"][dim][1]
    q = ds["join"](select(distinct(col).label("v")).select_from(ds["base"]))
    if ds.get("student_scoped", True) and user.role != "admin":
        q = q.where(Student.advisor_id == user.id)
    return sorted(str(v) for (v,) in db.execute(q.limit(limit)) if v is not None)


# The dashboard every staff member gets the first time.
DEFAULT_DASHBOARD = {
    "name": "Career services overview",
    "description": "Students, applications, points and shared jobs. Use the filters at the top to narrow everything at once.",
    "widgets": [
        {"title": "Active students", "width": 1, "config": {"dataset": "students", "metric": "count", "chart": "number",
                                                             "filters": {"student_status": ["active"]}}},
        {"title": "Applications (last 30 days)", "width": 1, "config": {"dataset": "applications", "metric": "count",
                                                                        "chart": "number", "range_days": 30}},
        {"title": "Offers (last 90 days)", "width": 1, "config": {"dataset": "applications", "metric": "offers",
                                                                  "chart": "number", "range_days": 90}},
        {"title": "Shared jobs applied to", "width": 1, "config": {"dataset": "job_shares", "metric": "applied",
                                                                   "chart": "number", "range_days": 90}},
        {"title": "Students by stage", "width": 2, "config": {"dataset": "students", "metric": "count", "group_by": "stage",
                                                              "chart": "bar", "filters": {"student_status": ["active"]}}},
        {"title": "Job guarantee by advisor", "width": 2, "config": {"dataset": "students", "metric": "count",
                                                                     "group_by": "advisor", "split_by": "guarantee",
                                                                     "chart": "stacked", "filters": {"student_status": ["active"]}}},
        {"title": "Applications per week", "width": 4, "config": {"dataset": "applications", "metric": "count",
                                                                  "group_by": "time:week", "split_by": "program",
                                                                  "chart": "line", "range_days": 120}},
        {"title": "Applications by status", "width": 2, "config": {"dataset": "applications", "metric": "count",
                                                                   "group_by": "app_status", "chart": "bar", "range_days": 90}},
        {"title": "Points gained vs lost by rule", "width": 2, "config": {"dataset": "points", "metric": "net",
                                                                         "group_by": "event_type", "chart": "bar",
                                                                         "range_days": 30, "limit": 12}},
        {"title": "Job Radar by country", "width": 2, "config": {"dataset": "jobs", "metric": "count",
                                                                 "group_by": "job_country", "split_by": "job_program",
                                                                 "chart": "stacked", "range_days": 30}},
        {"title": "Shared jobs: student answers", "width": 2, "config": {"dataset": "job_shares", "metric": "count",
                                                                         "group_by": "share_status", "chart": "bar",
                                                                         "range_days": 90}},
    ],
}
