"""Resume builder v2 API (students: their own; staff: any of their students)."""
from datetime import timedelta

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import current_user, require_staff, student_for
from ..config import settings
from ..db import get_db
from ..models import (
    AiUsage, Application, AuditLog, Job, ResumeComment, ResumeProfile, ResumeSnapshot, ResumeTemplate, Student, User,
)
from ..notify import alert_advisor, notify_student
from ..rules import get_rules
from ..serializers import iso
from ..services import resume_ai as R
from ..services.resume import extract_text
from .. import engine
from ..timeutil import now_utc, week_bounds_utc, week_start

router = APIRouter(tags=["resume"])


def _profile(db: Session, st: Student, create: bool = True) -> ResumeProfile | None:
    p = db.scalar(select(ResumeProfile).where(ResumeProfile.student_id == st.id))
    if not p and create:
        data = R.normalize({})
        data["basics"]["name"], data["basics"]["email"] = st.user.name, st.user.email
        p = ResumeProfile(student_id=st.id, data=data, template="classic", status="draft")
        db.add(p)
        db.flush()
    return p


def _snap_dict(s: ResumeSnapshot, full: bool = False) -> dict:
    d = {"id": s.id, "kind": s.kind, "label": s.label, "template": s.template, "job_title": s.job_title,
         "company": s.company, "application_id": s.application_id, "job_id": s.job_id, "created_at": iso(s.created_at),
         "downloads": s.downloads, "match_score": (s.analysis or {}).get("match_score")}
    if full:
        d["data"], d["analysis"] = s.data, s.analysis
    return d


def _tailored_this_week(db: Session, st: Student) -> int:
    start, _ = week_bounds_utc(week_start())
    return db.scalar(select(func.count(ResumeSnapshot.id)).where(
        ResumeSnapshot.student_id == st.id, ResumeSnapshot.kind == "tailored",
        ResumeSnapshot.created_at >= start)) or 0


def _month_spend(db: Session) -> float:
    start = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return float(db.scalar(select(func.coalesce(func.sum(AiUsage.cost_usd), 0)).where(AiUsage.created_at >= start)) or 0)


def _ai_state(db: Session, user: User) -> dict:
    r = get_rules(db)
    spent = _month_spend(db)
    budget = float(r.ai_staff_monthly_budget_usd)
    return {"available": user.role != "student" and bool(settings.anthropic_api_key) and spent < budget,
            "spent_usd": round(spent, 2), "budget_usd": budget, "configured": bool(settings.anthropic_api_key)}


@router.get("/students/{student_id}/resume")
def get_resume(student_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    p = _profile(db, st)
    db.commit()
    r = get_rules(db)
    comments = db.scalars(select(ResumeComment).where(ResumeComment.student_id == st.id)
                          .order_by(ResumeComment.created_at.desc())).all()
    snaps = db.scalars(select(ResumeSnapshot).where(ResumeSnapshot.student_id == st.id)
                       .order_by(ResumeSnapshot.created_at.desc()).limit(50)).all()
    authors = {u.id: u.name for u in db.scalars(select(User).where(User.id.in_({c.author_id for c in comments}))).all()} if comments else {}
    return {
        "student": {"id": st.id, "name": st.user.name},
        "data": p.data, "template": p.template, "templates": R.TEMPLATES, "status": p.status,
        "submitted_at": iso(p.submitted_at), "approved_at": iso(p.approved_at), "updated_at": iso(p.updated_at),
        "can_download": user.role != "student" or p.approved_at is not None,
        "is_empty": R.is_empty(p.data),
        "comments": [{"id": c.id, "section": c.section, "body": c.body, "resolved": c.resolved,
                      "author": authors.get(c.author_id), "created_at": iso(c.created_at)} for c in comments],
        "versions": [_snap_dict(s) for s in snaps],
        "tailor_cap": {"used": _tailored_this_week(db, st), "limit": int(r.resume_tailor_week_cap)},
        "ai": _ai_state(db, user),
    }


class SaveIn(BaseModel):
    data: dict
    template: str = Field("classic", pattern="^(classic|modern|technical)$")


@router.put("/students/{student_id}/resume")
def save_resume(student_id: str, body: SaveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    p = _profile(db, st)
    p.data, p.template, p.updated_by = R.normalize(body.data), body.template, user.id
    if user.role == "student" and p.status in ("approved", "changes_requested"):
        p.status = "draft"  # downloads stay unlocked once the first version was approved
    db.commit()
    return {"ok": True, "data": p.data, "status": p.status, "updated_at": iso(p.updated_at)}


@router.post("/students/{student_id}/resume/upload")
async def upload_cv(student_id: str, file: UploadFile = File(...), user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    """Read an uploaded CV and return the text plus the copy-paste prompt that turns it into the master resume."""
    st = student_for(db, user, student_id)
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "That file is over 5 MB.")
    text = extract_text(file.filename, raw)
    if len(text) < 150:
        raise HTTPException(422, "We could only read a few words from that file. Try the .docx version, or paste the text.")
    return {"text": text[:20000], "prompt": R.import_prompt(text)}


class AnswerIn(BaseModel):
    answer: str = Field(min_length=2, max_length=200000)


@router.post("/students/{student_id}/resume/import")
def import_answer(student_id: str, body: AnswerIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Paste back the AI's answer to the import prompt: becomes the master resume (the previous one is kept)."""
    st = student_for(db, user, student_id)
    data = R.normalize(R.parse_answer(body.answer))
    if R.is_empty(data):
        raise HTTPException(422, "The answer didn't include any resume content. Check you pasted the full answer.")
    return _replace_master(db, st, user, data, "Imported from uploaded CV")


def _replace_master(db: Session, st: Student, user: User, data: dict, label: str) -> dict:
    p = _profile(db, st)
    if not R.is_empty(p.data):
        db.add(ResumeSnapshot(student_id=st.id, kind="master", label=f"Before: {label}", data=p.data,
                              template=p.template, created_by=user.id))
    p.data, p.updated_by = data, user.id
    if user.role == "student" and p.status == "approved":
        p.status = "draft"
    db.commit()
    return {"ok": True, "data": p.data}


class TailorIn(BaseModel):
    job_text: str | None = Field(default=None, max_length=20000)
    application_id: str | None = None
    job_id: str | None = None


def _job_context(db: Session, st: Student, body: TailorIn) -> tuple[str, str, str]:
    title = company = ""
    text = (body.job_text or "").strip()
    if body.job_id:
        j = db.get(Job, body.job_id)
        if j:
            title, company = j.title, j.company or ""
            text = text or "\n".join(x for x in [j.title, j.company, j.location, j.description] if x)
    if body.application_id:
        a = db.get(Application, body.application_id)
        if a and a.student_id == st.id:
            title, company = a.role, a.company
            text = text or f"{a.role} at {a.company}\n{a.notes or ''}"
    if len(text) < 80:
        raise HTTPException(422, "Paste the full job description (at least a few lines) so the suggestions fit the job.")
    return text, title, company


@router.post("/students/{student_id}/resume/tailor/prompt")
def tailor_prompt(student_id: str, body: TailorIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    p = _profile(db, st)
    if R.is_empty(p.data):
        raise HTTPException(422, "Build your master resume first (upload your CV or fill it in).")
    text, title, company = _job_context(db, st, body)
    db.commit()
    return {"prompt": R.tailor_prompt(p.data, text, title, company), "job_title": title, "company": company}


class ReviewIn(AnswerIn):
    pass


@router.post("/students/{student_id}/resume/tailor/review")
def tailor_review(student_id: str, body: ReviewIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Paste back the AI's tailoring answer: returns only the changes that point at real places in this resume."""
    st = student_for(db, user, student_id)
    p = _profile(db, st)
    return R.review_tailoring(R.parse_answer(body.answer), p.data)


class ApplyIn(BaseModel):
    changes: list[dict]


@router.post("/students/{student_id}/resume/tailor/apply")
def tailor_apply(student_id: str, body: ApplyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Preview the master resume with the accepted changes (nothing is saved until a version is created)."""
    st = student_for(db, user, student_id)
    p = _profile(db, st)
    return {"data": R.apply_changes(p.data, body.changes)}


class VersionIn(BaseModel):
    label: str = Field(min_length=2, max_length=255)
    data: dict
    template: str = Field("classic", pattern="^(classic|modern|technical)$")
    kind: str = Field("tailored", pattern="^(master|tailored)$")
    job_title: str | None = None
    company: str | None = None
    application_id: str | None = None
    job_id: str | None = None
    analysis: dict | None = None


@router.post("/students/{student_id}/resume/versions", status_code=201)
def save_version(student_id: str, body: VersionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    r = get_rules(db)
    if body.kind == "tailored" and user.role == "student" and _tailored_this_week(db, st) >= int(r.resume_tailor_week_cap):
        raise HTTPException(429, f"You've saved {int(r.resume_tailor_week_cap)} tailored resumes this week. The limit resets on Monday.")
    if body.application_id:
        a = db.get(Application, body.application_id)
        if not a or a.student_id != st.id:
            body.application_id = None
    s = ResumeSnapshot(student_id=st.id, kind=body.kind, label=body.label.strip(), data=R.normalize(body.data),
                       template=body.template, job_title=body.job_title, company=body.company,
                       application_id=body.application_id, job_id=body.job_id if body.job_id and db.get(Job, body.job_id) else None,
                       analysis=body.analysis, created_by=user.id)
    db.add(s)
    db.commit()
    return _snap_dict(s)


@router.get("/students/{student_id}/resume/versions/{vid}")
def get_version(student_id: str, vid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    s = db.get(ResumeSnapshot, vid)
    if not s or s.student_id != st.id:
        raise HTTPException(404, "Version not found")
    return _snap_dict(s, full=True)


@router.get("/students/{student_id}/resume/docx")
def download_docx(student_id: str, version: str | None = None, template: str | None = None,
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    p = _profile(db, st)
    if user.role == "student" and not p.approved_at:
        raise HTTPException(403, "Your advisor needs to approve your first resume before you can download it. "
                                 "Use “Send for review”.")
    data, tpl, label = p.data, template or p.template, "master"
    if version:
        s = db.get(ResumeSnapshot, version)
        if not s or s.student_id != st.id:
            raise HTTPException(404, "Version not found")
        data, tpl, label = s.data, template or s.template, s.company or s.label
        if user.role == "student" and s.kind == "tailored" and not s.downloads:
            _award_download(db, st, s)
        s.downloads = (s.downloads or 0) + 1
    if tpl not in R.TEMPLATES:
        tpl = "classic"
    db.commit()
    return Response(R.build_docx(data, tpl),
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{R.filename(data, label)}"'})


def _award_download(db: Session, st: Student, s: ResumeSnapshot) -> None:
    """Same points rule as before: first download of each tailored version, capped per week."""
    from ..models import PointsEvent
    r = get_rules(db)
    if not r.pts_resume_download:
        return
    start, _ = week_bounds_utc(week_start())
    n = db.scalar(select(func.count(PointsEvent.id)).where(
        PointsEvent.student_id == st.id, PointsEvent.event_type == "resume", PointsEvent.created_at >= start)) or 0
    if n < r.cap_resume_downloads_week:
        engine.award(db, st, "resume", r.pts_resume_download, f"Tailored resume · {s.company or s.label}",
                     source="manual", source_id=s.id, key=f"resume:{s.id}")


@router.post("/students/{student_id}/resume/submit")
def submit_for_review(student_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    p = _profile(db, st)
    if R.is_empty(p.data):
        raise HTTPException(422, "Fill in your resume before sending it for review.")
    p.status, p.submitted_at = "in_review", now_utc()
    alert_advisor(db, st, f"{st.user.name} sent their resume for review",
                  "Open Resume Studio to review, comment and approve it.", link=f"/staff/resumes/{st.id}")
    db.commit()
    return {"status": p.status}


class DecisionIn(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


@router.post("/advisor/students/{student_id}/resume/approve")
def approve(student_id: str, body: DecisionIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    p = _profile(db, st)
    first = p.approved_at is None
    p.status, p.approved_by = "approved", user.id
    p.approved_at = p.approved_at or now_utc()
    db.add(ResumeSnapshot(student_id=st.id, kind="master", label="Approved master resume", data=p.data,
                          template=p.template, created_by=user.id))
    engine.complete_profile_task(db, st, "cv", user)  # Stage 1 "Resume ready" + profile points
    db.add(AuditLog(actor_id=user.id, student_id=st.id, action="resume_approved", detail=body.note or "Resume approved"))
    notify_student(db, st, type="success", category="advisor", pref_key="session_notes",
                   title="Your resume is approved" + (": downloads are unlocked" if first else ""),
                   body=(body.note.strip() + "\n\n" if body.note else "") +
                        "Tailor it to each job in the Resume Builder and download any version you need.", link="/resume")
    db.commit()
    return {"status": p.status, "approved_at": iso(p.approved_at)}


@router.post("/advisor/students/{student_id}/resume/request-changes")
def request_changes(student_id: str, body: DecisionIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    p = _profile(db, st)
    p.status = "changes_requested"
    if body.note:
        db.add(ResumeComment(student_id=st.id, author_id=user.id, section=None, body=body.note.strip()))
    notify_student(db, st, type="info", category="advisor", pref_key="session_notes",
                   title=f"{user.name.split()[0]} asked for changes to your resume",
                   body=(body.note or "Open the Resume Builder to see the comments."), link="/resume")
    db.commit()
    return {"status": p.status}


class CommentIn(BaseModel):
    body: str = Field(min_length=2, max_length=2000)
    section: str | None = Field(default=None, max_length=40)


@router.post("/advisor/students/{student_id}/resume/comments", status_code=201)
def add_comment(student_id: str, body: CommentIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    c = ResumeComment(student_id=st.id, author_id=user.id, section=body.section, body=body.body.strip())
    db.add(c)
    db.commit()
    return {"id": c.id}


@router.patch("/students/{student_id}/resume/comments/{cid}")
def resolve_comment(student_id: str, cid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    c = db.get(ResumeComment, cid)
    if not c or c.student_id != st.id:
        raise HTTPException(404, "Comment not found")
    c.resolved = not c.resolved
    db.commit()
    return {"resolved": c.resolved}


# ── staff: AI on our key, under the monthly budget ──

def _charge(db: Session, user: User, st: Student | None, kind: str, tin: int, tout: int) -> None:
    r = get_rules(db)
    cost = tin / 1e6 * float(r.ai_price_input_per_mtok) + tout / 1e6 * float(r.ai_price_output_per_mtok)
    db.add(AiUsage(user_id=user.id, student_id=st.id if st else None, kind=kind, model=settings.anthropic_model,
                   input_tokens=tin, output_tokens=tout, cost_usd=round(cost, 5)))


def _check_budget(db: Session, user: User):
    state = _ai_state(db, user)
    if not state["configured"]:
        raise HTTPException(503, "AI isn't configured. Use the copy-paste prompt instead.")
    if not state["available"]:
        raise HTTPException(402, f"This month's AI budget (${state['budget_usd']:.0f}) is used up. Use the copy-paste "
                                 "prompt, or ask an admin to raise the budget in Rules & points.")


class AiImportIn(BaseModel):
    text: str = Field(min_length=150, max_length=40000)


@router.post("/advisor/students/{student_id}/resume/ai/import")
def ai_import(student_id: str, body: AiImportIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    _check_budget(db, user)
    text, tin, tout = R.run_claude(R.import_prompt(body.text))
    _charge(db, user, st, "resume_import", tin, tout)
    data = R.normalize(R.parse_answer(text))
    if R.is_empty(data):
        db.commit()
        raise HTTPException(502, "The AI didn't return resume content. Try again or use the copy-paste prompt.")
    return _replace_master(db, st, user, data, "Imported with AI")


@router.post("/advisor/students/{student_id}/resume/ai/tailor")
def ai_tailor(student_id: str, body: TailorIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    st = student_for(db, user, student_id)
    p = _profile(db, st)
    if R.is_empty(p.data):
        raise HTTPException(422, "Build the master resume first.")
    _check_budget(db, user)
    job_text, title, company = _job_context(db, st, body)
    text, tin, tout = R.run_claude(R.tailor_prompt(p.data, job_text, title, company))
    _charge(db, user, st, "resume_tailor", tin, tout)
    db.commit()
    return {**R.review_tailoring(R.parse_answer(text), p.data), "job_title": title, "company": company}


@router.get("/advisor/resumes")
def studio_list(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    q = select(Student).join(User, Student.user_id == User.id).where(
        User.is_active.is_(True), Student.status.in_(["active", "hired", "onboarding"]))
    if user.role != "admin":
        q = q.where(Student.advisor_id == user.id)
    students = db.scalars(q).all()
    profiles = {p.student_id: p for p in db.scalars(select(ResumeProfile).where(
        ResumeProfile.student_id.in_([s.id for s in students]))).all()} if students else {}
    counts = dict(db.execute(select(ResumeSnapshot.student_id, func.count()).where(
        ResumeSnapshot.kind == "tailored").group_by(ResumeSnapshot.student_id)).all())
    out = []
    for s in students:
        p = profiles.get(s.id)
        status = "none" if not p or R.is_empty(p.data) else p.status
        out.append({"id": s.id, "name": s.user.name, "cohort": s.cohort.name if s.cohort else None, "stage": s.stage,
                    "status": status, "approved_at": iso(p.approved_at) if p else None,
                    "updated_at": iso(p.updated_at) if p else None, "submitted_at": iso(p.submitted_at) if p else None,
                    "tailored": counts.get(s.id, 0), "template": p.template if p else None})
    rank = {"in_review": 0, "changes_requested": 1, "draft": 2, "none": 3, "approved": 4}
    out.sort(key=lambda x: (rank.get(x["status"], 5), x["name"]))
    return {"items": out, "ai": _ai_state(db, user)}


@router.get("/admin/ai-usage")
def ai_usage(user: User = Depends(require_staff), db: Session = Depends(get_db)):
    start = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    rows = db.execute(select(User.name, func.count(AiUsage.id), func.sum(AiUsage.cost_usd)).join(User, AiUsage.user_id == User.id)
                      .where(AiUsage.created_at >= start).group_by(User.name)).all()
    return {**_ai_state(db, user), "by_user": [{"name": n, "calls": c, "cost_usd": round(float(t or 0), 2)} for n, c, t in rows]}


# ── template library: example resumes staff curate; students start from them ──

def _tpl_dict(t: ResumeTemplate, full: bool = True) -> dict:
    d = {"id": t.id, "name": t.name, "program": t.program, "description": t.description, "layout": t.layout,
         "active": t.active, "position": t.position, "updated_at": iso(t.updated_at)}
    if full:
        d["data"] = t.data
    return d


@router.get("/resume/templates")
def list_templates(all: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(ResumeTemplate).order_by(ResumeTemplate.position, ResumeTemplate.name)
    if not (all and user.role != "student"):
        q = q.where(ResumeTemplate.active.is_(True))
    return [_tpl_dict(t) for t in db.scalars(q).all()]


class TemplateIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    program: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=400)
    data: dict
    layout: str = Field("classic", pattern="^(classic|modern|technical)$")
    active: bool = True


def _clean_example(data: dict) -> dict:
    """Templates never carry a real person's contact details: the student's own are filled in when they use one."""
    d = R.normalize(data)
    d["basics"] = {**d["basics"], "name": "", "email": "", "phone": "", "links": []}
    return d


@router.post("/advisor/resume-templates", status_code=201)
def create_template(body: TemplateIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    if R.is_empty(body.data):
        raise HTTPException(422, "Add some content (summary, skills, experience or projects) before saving the template.")
    last = db.scalar(select(func.max(ResumeTemplate.position))) or 0
    t = ResumeTemplate(name=body.name.strip(), program=(body.program or "").strip() or None,
                       description=(body.description or "").strip() or None, data=_clean_example(body.data),
                       layout=body.layout, active=body.active, position=last + 1, created_by=user.id)
    db.add(t)
    db.add(AuditLog(actor_id=user.id, action="resume_template_created", detail=t.name))
    db.commit()
    return _tpl_dict(t)


@router.put("/advisor/resume-templates/{tid}")
def update_template(tid: str, body: TemplateIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    t = db.get(ResumeTemplate, tid)
    if not t:
        raise HTTPException(404, "Template not found")
    t.name, t.program, t.description = body.name.strip(), (body.program or "").strip() or None, (body.description or "").strip() or None
    t.data, t.layout, t.active = _clean_example(body.data), body.layout, body.active
    db.commit()
    return _tpl_dict(t)


class TemplateOrderIn(BaseModel):
    ids: list[str]


@router.post("/advisor/resume-templates/order")
def order_templates(body: TemplateOrderIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    for i, tid in enumerate(body.ids):
        t = db.get(ResumeTemplate, tid)
        if t:
            t.position = i
    db.commit()
    return {"ok": True}


@router.delete("/advisor/resume-templates/{tid}")
def delete_template(tid: str, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    t = db.get(ResumeTemplate, tid)
    if not t:
        raise HTTPException(404, "Template not found")
    if user.role != "admin" and t.created_by != user.id:
        raise HTTPException(403, "Only an admin or the person who created it can delete this template. You can hide it instead.")
    db.add(AuditLog(actor_id=user.id, action="resume_template_deleted", detail=t.name))
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.post("/advisor/resume-templates/upload")
async def template_upload(file: UploadFile = File(...), user: User = Depends(require_staff)):
    """Read an example CV: returns the text and the copy-paste prompt that turns it into a template."""
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "That file is over 5 MB.")
    text = extract_text(file.filename, raw)
    if len(text) < 150:
        raise HTTPException(422, "We could only read a few words from that file. Try the .docx version.")
    return {"text": text[:20000], "prompt": R.import_prompt(text)}


@router.post("/advisor/resume-templates/parse")
def template_parse(body: AnswerIn, user: User = Depends(require_staff)):
    """Paste back the AI's answer: returns the structured resume (not saved until you save the template)."""
    data = R.normalize(R.parse_answer(body.answer))
    if R.is_empty(data):
        raise HTTPException(422, "The answer didn't include any resume content. Check you pasted the full answer.")
    return {"data": _clean_example(data)}


@router.post("/advisor/resume-templates/ai-import")
def template_ai_import(body: AiImportIn, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    _check_budget(db, user)
    text, tin, tout = R.run_claude(R.import_prompt(body.text))
    _charge(db, user, None, "template_import", tin, tout)
    db.commit()
    data = R.normalize(R.parse_answer(text))
    if R.is_empty(data):
        raise HTTPException(502, "The AI didn't return resume content. Try again or use the copy-paste prompt.")
    return {"data": _clean_example(data)}
