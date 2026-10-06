import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import create_token, current_user, hash_password, verify_password
from ..config import settings
from ..db import get_db
from ..models import User
from ..serializers import initials, student_brief
from ..timeutil import now_utc

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class PasswordIn(BaseModel):
    current_password: str
    new_password: str


def me_dict(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "initials": initials(u.name), "role": u.role,
            "student": student_brief(u.student) if u.student else None}


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    u = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if not u or not u.is_active or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Wrong email or password")
    u.last_login_at = now_utc()
    if u.student:
        u.student.last_activity_at = now_utc()
    db.commit()
    return {"token": create_token(u), "user": me_dict(u)}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return me_dict(user)


@router.post("/change-password")
def change_password(body: PasswordIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Your current password is wrong")
    if len(body.new_password) < 8:
        raise HTTPException(422, "Use at least 8 characters")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return {"ok": True}


class BreathcodeIn(BaseModel):
    token: str


@router.post("/breathcode")
def breathcode_login(body: BreathcodeIn, db: Session = Depends(get_db)):
    """Phase 2 — sign in with a 4Geeks (Breathcode) token. Disabled until BREATHCODE_ENABLED=true.
    Matches the Breathcode user to a Career Hub user by external_id, then by email."""
    if not settings.breathcode_enabled:
        raise HTTPException(404, "4Geeks login is not enabled yet")
    try:
        r = httpx.get(f"{settings.breathcode_api_url}/v1/auth/user/me",
                      headers={"Authorization": f"Token {body.token}"}, timeout=10)
    except httpx.HTTPError:
        raise HTTPException(502, "Couldn't reach the 4Geeks platform")
    if r.status_code != 200:
        raise HTTPException(401, "Your 4Geeks session is not valid")
    data = r.json()
    ext_id, email = str(data.get("id")), (data.get("email") or "").lower()
    u = db.scalar(select(User).where(User.external_provider == "breathcode", User.external_id == ext_id)) or \
        db.scalar(select(User).where(func.lower(User.email) == email))
    if not u or not u.is_active:
        raise HTTPException(403, "Your 4Geeks account isn't enrolled in GeekForce yet")
    u.external_provider, u.external_id, u.last_login_at = "breathcode", ext_id, now_utc()
    db.commit()
    return {"token": create_token(u), "user": me_dict(u)}
