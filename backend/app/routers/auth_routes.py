"""Sign-in. The only way in is a 4Geeks (Breathcode) account.

The browser goes to the 4Geeks hosted login (email + password) or to 4Geeks' GitHub OAuth. 4Geeks sends it back to
/auth/callback?token=<4geeks token>, and the web app exchanges that token here for a Career Hub JWT.
Career Hub never sees a password. See .agents/skills/bc-authenticate-student-authentication.

DEV_PASSWORD_LOGIN=true re-enables the old email + password form, for local development with the demo accounts
(they don't exist on 4Geeks). It must stay off in production.
"""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import create_token, current_user, verify_password
from ..config import settings
from ..db import get_db
from ..i18n import lang_of
from ..models import User
from ..serializers import initials, student_brief
from ..timeutil import now_utc

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("geekforce.auth")


def me_dict(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "initials": initials(u.name), "role": u.role,
            "language": lang_of(u), "language_set": u.language is not None,
            "student": student_brief(u.student) if u.student else None}


@router.get("/config")
def auth_config():
    """What the login page needs: where 4Geeks lives, and whether the local-only password form is on."""
    return {"breathcode_url": settings.breathcode_api_url.rstrip("/"), "dev_password_login": settings.dev_password_login}


class BreathcodeIn(BaseModel):
    token: str


def _breathcode_profile(token: str) -> dict:
    """Validate a 4Geeks login token and return its profile (GET /v1/auth/user/me)."""
    try:
        r = httpx.get(f"{settings.breathcode_api_url.rstrip('/')}/v1/auth/user/me",
                      headers={"Authorization": f"Token {token}", "Accept": "application/json"}, timeout=10)
    except httpx.HTTPError as e:
        log.warning("4Geeks unreachable: %s", e)
        raise HTTPException(502, "Couldn't reach 4Geeks. Try again in a minute.")
    if r.status_code in (401, 403):
        raise HTTPException(401, "Your 4Geeks session expired. Sign in again.")
    if r.status_code != 200:
        log.warning("4Geeks /user/me answered %s", r.status_code)
        raise HTTPException(502, "Couldn't reach 4Geeks. Try again in a minute.")
    return r.json()


@router.post("/breathcode")
def breathcode_login(body: BreathcodeIn, db: Session = Depends(get_db)):
    """Exchange a 4Geeks login token for a Career Hub JWT.
    Matches the 4Geeks user by external id (after the first sign-in), else by email. Accounts are never created
    here: students come from the Notion roster and staff are added by an admin, so the Hub keeps deciding roles."""
    data = _breathcode_profile(body.token.strip())
    ext_id, email = str(data.get("id") or ""), (data.get("email") or "").strip().lower()
    if not ext_id:
        raise HTTPException(401, "Your 4Geeks session expired. Sign in again.")
    u = db.scalar(select(User).where(User.external_provider == "breathcode", User.external_id == ext_id))
    if not u and email:
        u = db.scalar(select(User).where(func.lower(User.email) == email))
    if not u:
        raise HTTPException(403, "Your 4Geeks account isn't enrolled in GeekForce yet. Ask your advisor to add the email you use on 4Geeks.")
    if not u.is_active:
        raise HTTPException(403, "Your GeekForce account is turned off. Ask your advisor.")
    u.external_provider, u.external_id, u.last_login_at = "breathcode", ext_id, now_utc()
    db.commit()
    return {"token": create_token(u), "user": me_dict(u)}


class LoginIn(BaseModel):
    email: EmailStr
    password: str


@router.post("/login", include_in_schema=False)
def dev_login(body: LoginIn, db: Session = Depends(get_db)):
    """Local development only (DEV_PASSWORD_LOGIN=true): sign in with a seeded password."""
    if not settings.dev_password_login:
        raise HTTPException(404, "Sign in with your 4Geeks account")
    u = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if not u or not u.is_active or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Wrong email or password")
    u.last_login_at = now_utc()  # recorded, but logging in alone doesn't count as job-search activity
    db.commit()
    return {"token": create_token(u), "user": me_dict(u)}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return me_dict(user)


class LanguageIn(BaseModel):
    language: str


@router.put("/language")
def set_language(body: LanguageIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.language not in ("en", "es"):
        raise HTTPException(422, "Language must be en or es")
    user.language = body.language
    db.commit()  # ActiveCampaign gets GF_LANG with the next sync or state change
    return me_dict(user)
