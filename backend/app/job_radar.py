"""Job Radar: open opportunities from Adzuna, grokbot (webhook) and the team, matched to students by program.

Dedupe: one row per (source, external_id); a job already seen from another source (same normalized URL, or same
title + company within 14 days) is merged instead of duplicated.
"""
import logging
import re
from datetime import datetime, timedelta
from urllib.parse import urlsplit, urlunsplit

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

from .config import settings
from .models import Job, Student
from .timeutil import UTC, now_utc

log = logging.getLogger("geekforce.jobs")

PROGRAMS = {
    "full_stack": "Full Stack",
    "ai_engineering": "AI Engineering",
    "data_science": "Data Science & ML",
    "cybersecurity": "Cybersecurity",
}

# Title sets searched every morning (Adzuna "what" phrases), per program. Entry-level wording keeps it relevant.
TITLE_SETS = {
    "full_stack": ["junior software engineer", "junior full stack developer", "junior frontend developer",
                   "junior web developer", "entry level software engineer"],
    "ai_engineering": ["junior ai engineer", "ai engineer entry level", "junior machine learning engineer",
                       "ai solutions engineer", "forward deployed engineer"],
    "data_science": ["junior data analyst", "junior data scientist", "entry level data analyst",
                     "business intelligence analyst junior"],
    "cybersecurity": ["soc analyst", "junior cybersecurity analyst", "it security analyst entry level",
                      "junior security engineer"],
}

_KEYWORDS = [  # (regex on title, program) — first match wins
    (r"\b(ai|a\.i\.|llm|genai|machine learning|ml engineer|forward deployed|prompt)\b", "ai_engineering"),
    (r"\b(data (analyst|scientist|engineer)|analytics|business intelligence|bi analyst|tableau|sql analyst)\b", "data_science"),
    (r"\b(soc|security|cyber|siem|penetration|infosec|grc)\b", "cybersecurity"),
    (r"\b(software|developer|engineer|frontend|front-end|backend|back-end|full ?stack|web|react|node|javascript|python developer)\b", "full_stack"),
]
SENIOR = re.compile(r"\b(senior|sr\.?|staff|principal|lead|manager|director|head of|architect|vp)\b", re.I)


def program_for_title(title: str) -> str | None:
    t = (title or "").lower()
    for pattern, prog in _KEYWORDS:
        if re.search(pattern, t):
            return prog
    return None


def student_program(st: Student) -> str | None:
    raw = ((st.cohort.program if st.cohort else None) or "").lower()
    if not raw:
        return None
    if "ai" in raw.split() or "ai engineering" in raw or raw.startswith("ai") or "ai-" in raw:
        return "ai_engineering"
    if "data" in raw or "dsml" in raw:
        return "data_science"
    if "cyber" in raw:
        return "cybersecurity"
    if "full" in raw or "stack" in raw or raw.startswith("pt-") or raw.startswith("ft-"):
        return "full_stack"
    return None


def url_key(url: str | None) -> str | None:
    if not url:
        return None
    try:
        p = urlsplit(url.strip())
    except ValueError:
        return None
    host = p.netloc.lower().removeprefix("www.")
    path = p.path.rstrip("/")
    keep = ""
    if "linkedin.com" in host:
        m = re.search(r"/jobs/view/(\d+)", path)
        path = f"/jobs/view/{m.group(1)}" if m else path
    elif "currentJobId" in (p.query or ""):
        keep = p.query
    return urlunsplit(("https", host, path, keep, ""))[:500] or None


def work_mode_of(*texts: str | None) -> str | None:
    t = " ".join(x or "" for x in texts).lower()
    if "hybrid" in t:
        return "hybrid"
    if "remote" in t:
        return "remote"
    if "on-site" in t or "onsite" in t or "in office" in t:
        return "onsite"
    return None


def _parse_dt(v) -> datetime | None:
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=UTC)
    except ValueError:
        return None


FIELDS = ("title", "company", "location", "work_mode", "url", "description", "program", "posted_at", "salary_min",
          "salary_max", "contact_name", "contact_handle", "outreach_status", "is_partner", "notes")


def upsert(db: DB, source: str, data: dict) -> tuple[Job, bool]:
    """Insert or update one job. Returns (job, created)."""
    title = (data.get("title") or "").strip()[:255]
    if not title:
        raise ValueError("title is required")
    ext = str(data.get("external_id") or data.get("id") or data.get("url") or f"{title}|{data.get('company')}")[:255]
    key = url_key(data.get("url"))
    job = db.scalar(select(Job).where(Job.source == source, Job.external_id == ext))
    if not job and key:
        job = db.scalar(select(Job).where(Job.url_key == key))
    if not job and data.get("company"):
        job = db.scalar(select(Job).where(func.lower(Job.title) == title.lower(),
                                          func.lower(Job.company) == str(data["company"]).lower(),
                                          Job.created_at >= now_utc() - timedelta(days=14)))
    created = job is None
    if created:
        job = Job(source=source, external_id=ext, title=title)
        db.add(job)
    vals = {k: data.get(k) for k in FIELDS if data.get(k) not in (None, "")}
    vals["title"] = title
    if "posted_at" in vals:
        vals["posted_at"] = _parse_dt(vals["posted_at"])
    if "description" in vals:
        vals["description"] = str(vals["description"])[:6000]
    for k in ("company", "location", "contact_name", "contact_handle"):
        if k in vals:
            vals[k] = str(vals[k])[:255]
    if "url" in vals:
        vals["url"] = str(vals["url"])[:1000]
    if vals.get("outreach_status") not in (None, "none", "contacted", "replied", "interviewing", "closed"):
        vals.pop("outreach_status")
    if not created and job.outreach_status not in ("none", None) and vals.get("outreach_status") == "none":
        vals.pop("outreach_status")  # never move outreach backwards
    if not created:
        for k in ("url", "external_id"):  # keep the first link we saw
            if getattr(job, k, None):
                vals.pop(k, None)
    for k, v in vals.items():
        setattr(job, k, v)
    if not job.program:
        job.program = program_for_title(title)
    if not job.work_mode:
        job.work_mode = work_mode_of(title, job.location, job.description)
    job.url_key = job.url_key or key
    job.active = True
    if data.get("raw") is not None:
        job.raw = data["raw"]
    return job, created


# ── Adzuna ──

def adzuna_rows(what: str, transport: httpx.BaseTransport | None = None, max_days_old: int = 1) -> list[dict]:
    url = f"https://api.adzuna.com/v1/api/jobs/{settings.adzuna_country}/search/1"
    params = {"app_id": settings.adzuna_app_id, "app_key": settings.adzuna_app_key, "what": what,
              "max_days_old": max_days_old, "results_per_page": 50, "sort_by": "date", "content-type": "application/json"}
    with httpx.Client(timeout=30, transport=transport) as c:
        r = c.get(url, params=params)
        r.raise_for_status()
        return r.json().get("results", [])


def from_adzuna(row: dict, program: str) -> dict:
    return {
        "external_id": str(row.get("id")), "title": row.get("title", "").replace("<strong>", "").replace("</strong>", ""),
        "company": (row.get("company") or {}).get("display_name"),
        "location": (row.get("location") or {}).get("display_name"), "url": row.get("redirect_url"),
        "description": row.get("description"), "posted_at": row.get("created"), "program": program,
        "salary_min": int(row["salary_min"]) if row.get("salary_min") else None,
        "salary_max": int(row["salary_max"]) if row.get("salary_max") else None,
    }


def sweep_adzuna(db: DB, transport: httpx.BaseTransport | None = None) -> dict:
    if not (settings.adzuna_app_id and settings.adzuna_app_key):
        return {"ok": False, "error": "Adzuna isn't connected (set ADZUNA_APP_ID and ADZUNA_APP_KEY)."}
    found = created = skipped = 0
    errors = []
    for program, phrases in TITLE_SETS.items():
        for what in phrases:
            try:
                rows = adzuna_rows(what, transport)
            except Exception as e:  # noqa: BLE001
                errors.append(f"{what}: {e}")
                continue
            for row in rows:
                found += 1
                data = from_adzuna(row, program)
                if SENIOR.search(data["title"] or ""):
                    skipped += 1
                    continue
                _, new = upsert(db, "adzuna", data)
                created += int(new)
            db.commit()
    return {"ok": not errors or bool(found), "found": found, "created": created, "skipped_senior": skipped,
            "errors": errors[:5]}


# ── matching ──

def candidates(db: DB, job: Job, limit: int = 12) -> list[Student]:
    """Students who could take this job: same program, actively searching, guarantee not suspended."""
    rows = db.scalars(select(Student).where(Student.status == "active")).all()
    out = []
    for st in rows:
        if st.guarantee_status == "suspended" or st.on_hold:
            continue
        if st.stage not in (None, "job_hunting", "interview_prep"):
            continue
        if job.program and student_program(st) != job.program:
            continue
        out.append(st)
    out.sort(key=lambda s: (s.stage != "job_hunting", -(s.career_points or 0)))
    return out[:limit]
