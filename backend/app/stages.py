"""The GeekForce journey: Not started → Stage 1 Profile → Stage 2 Interview prep → Stage 3 Job hunting → Placed.

Each stage has a checklist built from hub data (profile tasks, mock interviews, applications) and the Notion
"CS Projects Submitted" field. Advisors move students between stages; every change is logged, the student is told
what's next, and an event goes to ActiveCampaign (stage tag) and to the automation webhook (n8n).
"""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

from . import events
from .i18n import Cat, L, M
from .models import Application, AuditLog, ProfileTask, Session, Student, User
from .timeutil import now_utc, week_start

ORDER = ["not_started", "profile", "interview_prep", "job_hunting", "placed"]
LABEL = {"not_started": "Not started", "profile": "Stage 1 · Profile", "interview_prep": "Stage 2 · Interview prep",
         "job_hunting": "Stage 3 · Job hunting", "placed": "Placed"}
NEXT_STEPS = {
    "profile": "Get your resume, LinkedIn and GitHub ready. Your advisor reviews each one.",
    "interview_prep": "Practice: a behavioral mock interview and a technical mock interview with your advisor.",
    "job_hunting": "Apply every week and log it. Your weekly target and the Job Guarantee checks start now.",
    "placed": "Congratulations on the new job! Tell your advisor your start date.",
    "not_started": "Book your first 1:1 with your advisor to begin.",
}


def _notion_done(st: Student) -> set[str]:
    snap = (st.notion_snapshot or {}).get("academic") or {}
    vals = snap.get("CS Projects Submitted") or []
    return {str(v).lower() for v in (vals if isinstance(vals, list) else [vals])}


def progress(db: DB, st: Student, weekly_target: int | None = None) -> dict:
    tasks = {t for (t,) in db.execute(select(ProfileTask.task).where(ProfileTask.student_id == st.id)).all()}
    notion = _notion_done(st)
    mocks = db.scalar(select(func.count(Session.id)).where(
        Session.student_id == st.id, Session.session_type == "mock_interview", Session.attendance == "attended")) or 0
    interviews = db.scalar(select(func.count(Application.id)).where(
        Application.student_id == st.id, Application.status.in_(["phone_screen", "technical", "final", "offer"]))) or 0
    from .engine import applications_in_week
    apps_week = applications_in_week(db, st.id, week_start())

    def item(label, done, how):
        return {"label": L(label), "done": bool(done), "how": L(how)}

    checklist = {
        "profile": [
            item("Resume ready", "cv" in tasks or "resume" in notion, "Resume uploaded or approved"),
            item("LinkedIn optimized", "linkedin" in tasks or "linkedin" in notion, "Profile task or Notion"),
            item("GitHub polished", "github" in tasks or "github" in notion, "Profile task or Notion"),
            item("Professional headshot", "headshot" in tasks, "Profile task"),
        ],
        "interview_prep": [
            item("Behavioral mock interview", mocks >= 1 or "behavioural interview" in notion or "behavioral interview" in notion,
                 "Mock interview logged or Notion"),
            item("Technical mock interview", mocks >= 2 or "tech interview" in notion, "Mock interview logged or Notion"),
        ],
        "job_hunting": [
            {"label": L("{n} applications this week", n=weekly_target or 15), "done": bool(weekly_target and apps_week >= weekly_target),
             "how": L("{n} so far", n=apps_week)},
            item("First interview", interviews > 0, "An application reached interviews"),
        ],
    }
    current = st.stage or "not_started"
    stages = []
    for key in ORDER:
        idx, cur = ORDER.index(key), ORDER.index(current)
        items = checklist.get(key, [])
        stages.append({"key": key, "label": L(LABEL[key]), "state": "done" if idx < cur else "current" if idx == cur else "next",
                       "items": items, "done_count": sum(i["done"] for i in items), "total": len(items)})
    cur_items = checklist.get(current, [])
    nxt = ORDER[ORDER.index(current) + 1] if current != "placed" else None
    return {"current": current, "label": L(LABEL[current]), "next": nxt, "next_label": L(LABEL[nxt]) if nxt else None,
            "ready_for_next": bool(cur_items) and all(i["done"] for i in cur_items) and current != "job_hunting",
            "changed_at": st.stage_changed_at.isoformat() if st.stage_changed_at else None,
            "next_steps": L(NEXT_STEPS[current]) if current in NEXT_STEPS else None, "stages": stages}


def set_stage(db: DB, st: Student, stage: str, actor: User | None, *, note: str | None = None,
              source: str = "advisor", notify: bool = True) -> bool:
    """Move a student to a stage. Returns False when nothing changed."""
    if stage not in ORDER:
        raise HTTPException(422, f"Unknown stage {stage}")
    old = st.stage or "not_started"
    if old == stage and st.stage is not None:
        return False
    st.stage = stage
    st.stage_changed_at = now_utc()
    if stage == "placed" and st.status == "active":
        st.status = "hired"
    db.add(AuditLog(actor_id=actor.id if actor else None, student_id=st.id, action="stage_changed",
                    detail=f"{LABEL.get(old, old)} → {LABEL[stage]}" + (f" · {note}" if note else "") + f" ({source})",
                    data={"from": old, "to": stage, "source": source}))
    if notify and st.status in ("active", "hired"):
        from .notify import notify_student
        up = ORDER.index(stage) > ORDER.index(old)
        notify_student(db, st, type="success" if up else "info", category="advisor", pref_key="guarantee",
                       title=M("You're now in {stage}", stage=LABEL[stage]) if up else M("Your stage changed to {stage}", stage=LABEL[stage]),
                       body=Cat((note or "").strip(), M(NEXT_STEPS.get(stage, ""))), link="/")
    events.emit(db, "stage_changed", st, {"from": old, "to": stage, "from_label": LABEL.get(old, old),
                                          "to_label": LABEL[stage], "source": source, "note": note,
                                          "by": actor.name if actor else None})
    return True
