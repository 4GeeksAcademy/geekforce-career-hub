import os

os.environ.setdefault("DATABASE_URL", os.getenv("TEST_DATABASE_URL", "postgresql://gf:gf@localhost:5432/geekforce_test"))
os.environ["SEED_DEMO"] = "false"
os.environ["ENABLE_SCHEDULER"] = "false"
os.environ["BREVO_API_KEY"] = ""

from datetime import date, timedelta  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: E402,F401
from app.auth import create_token, hash_password  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Cohort, Student, User  # noqa: E402
from app.timeutil import local_today  # noqa: E402


@pytest.fixture()
def db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    s = SessionLocal()
    s.info["sync_email"] = True
    yield s
    s.close()


@pytest.fixture()
def people(db):
    adv = User(email="adv@test.io", name="Valentina Ancieta", role="advisor", password_hash=hash_password("secret123"))
    adm = User(email="adm@test.io", name="Admin", role="admin", password_hash=hash_password("secret123"))
    su = User(email="stu@test.io", name="Maria González", role="student", password_hash=hash_password("secret123"))
    db.add_all([adv, adm, su])
    db.flush()
    c = Cohort(name="FS #47", program="Full Stack", region="usa", deadline_days=90)
    db.add(c)
    db.flush()
    st = Student(user_id=su.id, cohort_id=c.id, advisor_id=adv.id, career_points=80, guarantee_status="secured",
                 job_search_start_date=local_today() - timedelta(days=60))
    db.add(st)
    db.commit()
    return {"advisor": adv, "admin": adm, "student_user": su, "student": st, "cohort": c}


@pytest.fixture()
def client(db):
    return TestClient(app)


def auth(user):
    return {"Authorization": f"Bearer {create_token(user)}"}
