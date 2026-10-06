"""Authentication.

v1: email + password with JWT bearer tokens (the Chrome extension reuses the same token).
Phase 2: `breathcode_login` exchanges a 4Geeks (Breathcode) token for a Career Hub JWT, so students sign in
with their existing 4Geeks account. Everything downstream only depends on `current_user`.
"""
from datetime import timedelta

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import Student, User
from .timeutil import now_utc

ALGO = "HS256"
_bearer = HTTPBearer(auto_error=False)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user: User) -> str:
    exp = now_utc() + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": user.id, "role": user.role, "exp": exp}, settings.jwt_secret, algorithm=ALGO)


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)
) -> User:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=[ALGO])
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, sign in again")
    user = db.get(User, payload.get("sub"))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not active")
    return user


def require_roles(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
        return user
    return dep


require_staff = require_roles("advisor", "admin")
require_admin = require_roles("admin")


def student_for(db: Session, user: User, student_id: str) -> Student:
    """Resolve a student the user may see. 'me' = the signed-in student.
    Students see themselves; advisors see students assigned to them; admins see everyone."""
    if student_id == "me":
        if not user.student:
            raise HTTPException(404, "No student profile for this account")
        return user.student
    st = db.get(Student, student_id)
    if not st:
        raise HTTPException(404, "Student not found")
    if user.role == "admin":
        return st
    if user.role == "advisor" and st.advisor_id == user.id:
        return st
    if user.role == "student" and st.user_id == user.id:
        return st
    raise HTTPException(403, "Not allowed to view this student")
