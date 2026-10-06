"""Brevo transactional email. Failures are logged, never raised — email must not break the points engine."""
import html
import logging

import httpx

from ..config import settings

log = logging.getLogger("geekforce.brevo")
API = "https://api.brevo.com/v3/smtp/email"

ACCENT = {"critical": "#B4232A", "warning": "#7A4E00", "deduction": "#B4232A", "success": "#1B6FE0"}


def render(title: str, body: str, kind: str, link: str | None) -> str:
    color = ACCENT.get(kind, "#0B0B0F")
    url = f"{settings.app_url.rstrip('/')}{link or '/'}"
    return f"""<!doctype html><html><body style="margin:0;background:#F5F7FA;font-family:Arial,sans-serif;color:#0B0B0F">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #E6E9EF;border-radius:16px">
<tr><td style="padding:28px 32px 8px;font-size:12px;font-weight:bold;letter-spacing:2px;color:#5C6470">GEEKFORCE CAREER HUB</td></tr>
<tr><td style="padding:8px 32px;font-size:22px;font-weight:bold;color:{color}">{html.escape(title)}</td></tr>
<tr><td style="padding:8px 32px 20px;font-size:15px;line-height:1.5;color:#3F4752">{html.escape(body).replace(chr(10), '<br>')}</td></tr>
<tr><td style="padding:0 32px 32px"><a href="{url}" style="display:inline-block;background:#1B6FE0;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Open Career Hub</a></td></tr>
</table>
<div style="font-size:12px;color:#5C6470;padding-top:16px">4Geeks Academy · GeekForce career support</div>
</td></tr></table></body></html>"""


def send_email(to_email: str, to_name: str, subject: str, title: str, body: str, kind: str = "info",
               link: str | None = None) -> bool:
    if not settings.brevo_api_key:
        log.info("Brevo not configured; skipped email to %s: %s", to_email, subject)
        return False
    payload = {
        "sender": {"email": settings.brevo_sender_email, "name": settings.brevo_sender_name},
        "to": [{"email": to_email, "name": to_name}],
        "subject": subject,
        "htmlContent": render(title, body, kind, link),
        "tags": ["geekforce", kind],
    }
    try:
        r = httpx.post(API, json=payload, headers={"api-key": settings.brevo_api_key}, timeout=15)
        if r.status_code >= 300:
            log.warning("Brevo error %s: %s", r.status_code, r.text[:300])
            return False
        return True
    except httpx.HTTPError as e:
        log.warning("Brevo request failed: %s", e)
        return False
