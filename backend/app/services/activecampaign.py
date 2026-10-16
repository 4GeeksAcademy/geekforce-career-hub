"""ActiveCampaign: the Career Hub's email channel.

The hub doesn't send emails itself. For every email-worthy notification it
  1. upserts the student's contact with GeekForce custom fields (points, status, stage, last alert…), then
  2. re-applies the tag "GF Alert" (removed first, so the automation re-triggers every time).
An ActiveCampaign automation "Tag GF Alert is added → send email → remove tag" sends the message using
%GF_ALERT_TITLE%, %GF_ALERT_BODY% and %GF_ALERT_LINK%. The team owns the email design inside ActiveCampaign.

Status tags ("GF Secured", "GF At risk", "GF Suspended", "GF Professional Support", "GF Hired") are kept in sync
for segmentation. Account invitations use the tag "GF Invite" with %GF_LOGIN_LINK%.

Failures are logged, never raised: email must not break the points engine.
"""
import logging
import threading

import httpx

from ..config import settings

log = logging.getLogger("geekforce.ac")

FIELDS = {  # perstag → title
    "GF_POINTS": "GeekForce · Career points",
    "GF_STATUS": "GeekForce · Guarantee status",
    "GF_STAGE": "GeekForce · Stage",
    "GF_ADVISOR": "GeekForce · Advisor",
    "GF_COHORT": "GeekForce · Cohort",
    "GF_ALERT_TITLE": "GeekForce · Last alert title",
    "GF_ALERT_BODY": "GeekForce · Last alert message",
    "GF_ALERT_LINK": "GeekForce · Last alert link",
    "GF_LOGIN_LINK": "GeekForce · Login link",
}
STATUS_TAGS = {"secured": "GF Secured", "at_risk": "GF At risk", "suspended": "GF Suspended",
               "not_eligible": "GF Professional Support", "hired": "GF Hired"}
ALERT_TAG = "GF Alert"
INVITE_TAG = "GF Invite"

_lock = threading.Lock()
_field_ids: dict[str, str] = {}
_tag_ids: dict[str, str] = {}


def configured() -> bool:
    return bool(settings.ac_url and settings.ac_key)


class AC:
    def __init__(self, transport: httpx.BaseTransport | None = None):
        base = settings.ac_url.rstrip("/")
        if not base.endswith("/api/3"):
            base += "/api/3"
        self.http = httpx.Client(base_url=base, timeout=20, transport=transport,
                                 headers={"Api-Token": settings.ac_key, "Accept": "application/json"})

    def _req(self, method: str, path: str, **kw) -> dict:
        r = self.http.request(method, path, **kw)
        if r.status_code >= 300:
            raise RuntimeError(f"ActiveCampaign {method} {path} → {r.status_code}: {r.text[:300]}")
        return r.json() if r.content else {}

    # ── setup (cached per process) ──
    def field_ids(self) -> dict[str, str]:
        with _lock:
            if len(_field_ids) == len(FIELDS):
                return _field_ids
            existing = {}
            offset = 0
            while True:
                data = self._req("GET", "/fields", params={"limit": 100, "offset": offset})
                for f in data.get("fields", []):
                    existing[(f.get("perstag") or "").upper()] = f["id"]
                if len(data.get("fields", [])) < 100:
                    break
                offset += 100
            for tag, title in FIELDS.items():
                if tag not in existing:
                    f = self._req("POST", "/fields", json={"field": {"type": "textarea" if tag == "GF_ALERT_BODY" else "text",
                                                                    "title": title, "perstag": tag}})["field"]
                    self._req("POST", "/fieldRels", json={"fieldRel": {"field": f["id"], "relid": 0}})
                    existing[tag] = f["id"]
                _field_ids[tag] = existing[tag]
            return _field_ids

    def tag_id(self, name: str) -> str:
        with _lock:
            if name in _tag_ids:
                return _tag_ids[name]
        found = [t for t in self._req("GET", "/tags", params={"search": name}).get("tags", []) if t.get("tag") == name]
        tid = found[0]["id"] if found else self._req("POST", "/tags", json={"tag": {"tag": name, "tagType": "contact",
                                                                                     "description": "GeekForce Career Hub"}})["tag"]["id"]
        with _lock:
            _tag_ids[name] = tid
        return tid

    # ── contacts ──
    def sync_contact(self, email: str, name: str, fields: dict[str, str | int | None]) -> str:
        ids = self.field_ids()
        first, _, last = (name or "").partition(" ")
        body = {"contact": {"email": email, "firstName": first, "lastName": last,
                            "fieldValues": [{"field": ids[k], "value": "" if v is None else str(v)}
                                            for k, v in fields.items() if k in ids]}}
        return self._req("POST", "/contact/sync", json=body)["contact"]["id"]

    def contact_tags(self, contact_id: str) -> dict[str, str]:
        """tag id → contactTag id"""
        data = self._req("GET", f"/contacts/{contact_id}/contactTags")
        return {ct["tag"]: ct["id"] for ct in data.get("contactTags", [])}

    def add_tag(self, contact_id: str, name: str, retrigger: bool = False):
        tid = self.tag_id(name)
        current = self.contact_tags(contact_id)
        if tid in current:
            if not retrigger:
                return
            self._req("DELETE", f"/contactTags/{current[tid]}")
        self._req("POST", "/contactTags", json={"contactTag": {"contact": contact_id, "tag": tid}})

    def remove_tag(self, contact_id: str, name: str):
        tid = self.tag_id(name)
        ct = self.contact_tags(contact_id).get(tid)
        if ct:
            self._req("DELETE", f"/contactTags/{ct}")

    def set_status_tag(self, contact_id: str, status_key: str | None):
        for key, tag in STATUS_TAGS.items():
            if key == status_key:
                self.add_tag(contact_id, tag)
            else:
                self.remove_tag(contact_id, tag)


def student_fields(student) -> dict:
    if student is None:
        return {}
    return {
        "GF_POINTS": student.career_points, "GF_STATUS": student.guarantee_status, "GF_STAGE": student.stage or "",
        "GF_ADVISOR": student.advisor.name if student.advisor else "",
        "GF_COHORT": student.cohort.name if student.cohort else "",
    }


def status_key(student) -> str | None:
    if student is None:
        return None
    return "hired" if student.status == "hired" else student.guarantee_status


def send_alert(email: str, name: str, title: str, body: str, link: str | None, fields: dict | None = None,
               status: str | None = None, transport: httpx.BaseTransport | None = None) -> bool:
    if not configured():
        return False
    try:
        ac = AC(transport)
        url = link if (link or "").startswith("http") else f"{settings.app_url.rstrip('/')}{link or '/'}"
        cid = ac.sync_contact(email, name, {**(fields or {}), "GF_ALERT_TITLE": title, "GF_ALERT_BODY": body,
                                            "GF_ALERT_LINK": url})
        if status:
            ac.set_status_tag(cid, status)
        ac.add_tag(cid, ALERT_TAG, retrigger=True)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("ActiveCampaign alert failed for %s: %s", email, e)
        return False


def send_invite(email: str, name: str, login_link: str, fields: dict | None = None,
                transport: httpx.BaseTransport | None = None) -> bool:
    if not configured():
        return False
    try:
        ac = AC(transport)
        cid = ac.sync_contact(email, name, {**(fields or {}), "GF_LOGIN_LINK": login_link})
        ac.add_tag(cid, INVITE_TAG, retrigger=True)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("ActiveCampaign invite failed for %s: %s", email, e)
        return False


def sync_student(student, transport: httpx.BaseTransport | None = None) -> bool:
    """Keep fields and status tags current (nightly job). No email is triggered."""
    if not configured():
        return False
    try:
        ac = AC(transport)
        cid = ac.sync_contact(student.user.email, student.user.name, student_fields(student))
        ac.set_status_tag(cid, status_key(student))
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("ActiveCampaign sync failed for %s: %s", student.user.email, e)
        return False
