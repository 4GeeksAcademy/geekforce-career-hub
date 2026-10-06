"""Notion → Career Hub sync (read-only on the Notion side).

Source: the "Miami Student Tracker | Part-Time" data source. Rows with GeekForce Status = Active are synced.
Each student's "Job Application Tracker" (inside their Student's Tasks Sheet, linked through the
"Job hunting tracker" relation) is imported as application history while the student is in onboarding.

Uses the Notion API version 2025-09-03 (data sources). Needs an internal integration token shared with the
Student Tracker and the "GeekForce student's tasks" database.
"""
import logging
from datetime import date, datetime

import httpx

from ..config import settings

log = logging.getLogger("geekforce.notion")
API = "https://api.notion.com/v1"
VERSION = "2025-09-03"

# Notion "GeekForce Stages completion" → Career Hub stage (most advanced wins)
STAGE_MAP = [
    ("had a job", "placed"),
    ("all completed", "job_hunting"),
    ("stage 3", "job_hunting"),
    ("stage 2", "interview_prep"),
    ("stage 1", "profile"),
    ("to start", "not_started"),
    ("not started", "not_started"),
    ("did not follow-up", "not_started"),
]
STAGE_RANK = {"not_started": 0, "profile": 1, "interview_prep": 2, "job_hunting": 3, "placed": 4}

# Notion Job Application Tracker "Status" → Career Hub application status
APP_STATUS = {
    "applied": "applied", "contacted the recruiter / referal": "applied", "screening": "phone_screen",
    "interview scheduled": "phone_screen", "technical assessment": "technical", "final interview": "final",
    "offer received": "offer", "accepted": "offer", "rejected": "rejected", "withdrawn": "withdrawn",
}

PLAN_MAP = {"job guarantee": "job_guarantee", "regular student": "professional_support",
            "special scholarship": "professional_support"}  # "No-CareerSupport" → not synced


class NotionClient:
    def __init__(self, token: str, transport: httpx.BaseTransport | None = None):
        self.http = httpx.Client(base_url=API, timeout=30, transport=transport, headers={
            "Authorization": f"Bearer {token}", "Notion-Version": VERSION, "Content-Type": "application/json"})

    def _paginate(self, method: str, path: str, body: dict | None = None):
        cursor = None
        while True:
            if method == "POST":
                payload = dict(body or {}, page_size=100, **({"start_cursor": cursor} if cursor else {}))
                r = self.http.post(path, json=payload)
            else:
                r = self.http.get(path, params={"page_size": 100, **({"start_cursor": cursor} if cursor else {})})
            r.raise_for_status()
            data = r.json()
            yield from data.get("results", [])
            if not data.get("has_more"):
                return
            cursor = data.get("next_cursor")

    def query_data_source(self, data_source_id: str, filter: dict | None = None):
        return self._paginate("POST", f"/data_sources/{data_source_id}/query", {"filter": filter} if filter else {})

    def children(self, block_id: str):
        return self._paginate("GET", f"/blocks/{block_id}/children")

    def database_sources(self, database_id: str) -> list[str]:
        r = self.http.get(f"/databases/{database_id}")
        r.raise_for_status()
        return [d["id"] for d in r.json().get("data_sources", [])]

    def find_child_databases(self, page_id: str, title_contains: str, depth: int = 3) -> list[str]:
        found = []
        for b in self.children(page_id):
            t = b.get("type")
            if t == "child_database" and title_contains.lower() in (b["child_database"].get("title") or "").lower():
                found.append(b["id"])
            elif depth > 1 and (b.get("has_children") and t in ("child_page", "toggle", "column_list", "column",
                                                                 "callout", "synced_block", "tab")):
                found += self.find_child_databases(b["id"], title_contains, depth - 1)
        return found


# ── property helpers ──

def _prop(page: dict, name: str):
    return (page.get("properties") or {}).get(name) or {}


def text(page: dict, name: str) -> str:
    p = _prop(page, name)
    t = p.get("type")
    if t in ("title", "rich_text"):
        return "".join(x.get("plain_text", "") for x in p.get(t) or []).strip()
    if t == "email":
        return (p.get("email") or "").strip()
    if t == "url":
        return (p.get("url") or "").strip()
    if t == "select":
        return ((p.get("select") or {}).get("name") or "").strip()
    if t == "status":
        return ((p.get("status") or {}).get("name") or "").strip()
    return ""


def multi(page: dict, name: str) -> list[str]:
    return [o.get("name", "") for o in _prop(page, name).get("multi_select") or []]


def date_of(page: dict, name: str) -> date | None:
    d = (_prop(page, name).get("date") or {}).get("start")
    if not d:
        return None
    try:
        return date.fromisoformat(d[:10])
    except ValueError:
        return None


def relation(page: dict, name: str) -> list[str]:
    return [x["id"] for x in _prop(page, name).get("relation") or []]


def map_stage(stages: list[str], placement: str) -> str | None:
    if placement.lower() == "placed":
        return "placed"
    best = None
    for s in stages:
        low = s.lower()
        for key, val in STAGE_MAP:
            if key in low and (best is None or STAGE_RANK[val] > STAGE_RANK[best]):
                best = val
    return best


def student_from_page(page: dict) -> dict | None:
    """Map a Student Tracker row. Returns None for rows that shouldn't be synced."""
    email = text(page, "Email").lower()
    name = text(page, "Student Name")
    plan_raw = text(page, "Enrollment Plan").lower()
    if not email or not name or plan_raw == "no-careersupport":
        return None
    return {
        "notion_page_id": page["id"], "name": name, "email": email,
        "enrollment_plan": PLAN_MAP.get(plan_raw, "professional_support"),
        "advisor_name": text(page, "Advisor"), "cohort": text(page, "Cohort ID"), "program": text(page, "Program"),
        "city": text(page, "City"), "stage": map_stage(multi(page, "GeekForce Stages completion"),
                                                       text(page, "Placement Status")),
        "deadline_date": date_of(page, "JG deadline date"),
        "start_date": date_of(page, "Graduation date CS") or date_of(page, "Completion Date"),
        "tracker_pages": relation(page, "Job hunting tracker"),
    }


def application_from_page(page: dict) -> dict | None:
    company = text(page, "Company")
    if not company:
        return None
    applied = date_of(page, "Date Applied")
    if not applied:
        ct = page.get("created_time")
        applied = date.fromisoformat(ct[:10]) if ct else None
    return {
        "external_id": page["id"], "company": company[:255], "role": (text(page, "Position") or "—")[:255],
        "job_url": text(page, "Job URL") or None, "status": APP_STATUS.get(text(page, "Status").lower(), "applied"),
        "notes": "\n".join(x for x in (text(page, "Notes"), text(page, "Next Steps")) if x) or None,
        "applied_on": applied,
    }


def client() -> NotionClient | None:
    return NotionClient(settings.notion_token) if settings.notion_token else None
