"""Database models.

Kept portable (String UUIDs, generic JSON) so the schema can be lifted into the 4Geeks platform later.
`User.external_id` holds the Breathcode user id once phase 2 (4Geeks login) is enabled.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import (
    JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="student")  # student | advisor | admin
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    external_provider: Mapped[str | None] = mapped_column(String(40))  # "breathcode" in phase 2
    external_id: Mapped[str | None] = mapped_column(String(64), index=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    language: Mapped[str | None] = mapped_column(String(5))  # en | es; None = default (Spanish for LATAM/Spain cohorts)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # removed from lists, history kept

    student: Mapped["Student | None"] = relationship(
        back_populates="user", foreign_keys="Student.user_id", uselist=False
    )


class Cohort(TimestampMixin, Base):
    __tablename__ = "cohorts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255))
    program: Mapped[str | None] = mapped_column(String(120))
    location: Mapped[str | None] = mapped_column(String(120))
    region: Mapped[str] = mapped_column(String(20), default="usa")  # usa | latam | spain
    deadline_days: Mapped[int | None] = mapped_column(Integer)  # job search deadline for this program
    external_id: Mapped[str | None] = mapped_column(String(64))


class Student(TimestampMixin, Base):
    __tablename__ = "students"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True)
    cohort_id: Mapped[str | None] = mapped_column(ForeignKey("cohorts.id"))
    advisor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    country: Mapped[str | None] = mapped_column(String(80))

    career_points: Mapped[int] = mapped_column(Integer, default=80)
    # secured | at_risk | suspended | not_eligible
    guarantee_status: Mapped[str] = mapped_column(String(20), default="secured")
    # onboarding | active | hired | withdrawn | not_to_be_placed (checks frozen, out of job matching)
    status: Mapped[str] = mapped_column(String(20), default="active")
    status_reason: Mapped[str | None] = mapped_column(Text)
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # suspension is permanent

    consecutive_homework_misses: Mapped[int] = mapped_column(Integer, default=0)
    missed_meetings: Mapped[int] = mapped_column(Integer, default=0)
    reschedules_used: Mapped[int] = mapped_column(Integer, default=0)  # whole program; past the allowed ones = absent

    job_search_start_date: Mapped[date | None] = mapped_column(Date)
    deadline_days: Mapped[int | None] = mapped_column(Integer)  # overrides cohort / default
    deadline_extension_days: Mapped[int] = mapped_column(Integer, default=0)
    deadline_date: Mapped[date | None] = mapped_column(Date)  # explicit JG deadline (e.g. from Notion); overrides days
    notion_page_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    enrollment_plan: Mapped[str | None] = mapped_column(String(30))  # job_guarantee | professional_support
    # not_started | profile | interview_prep | job_hunting | placed (synced from Notion "GeekForce Stages completion")
    stage: Mapped[str | None] = mapped_column(String(20))
    stage_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notion_stage_seen: Mapped[str | None] = mapped_column(String(20))  # last stage value read from Notion
    on_hold: Mapped[bool] = mapped_column(Boolean, default=False)  # Not Started ladder day 15: checks frozen
    not_started_level: Mapped[int] = mapped_column(Integer, default=0)  # last ladder step applied (0/7/15/30)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    paused_from: Mapped[date | None] = mapped_column(Date)
    paused_until: Mapped[date | None] = mapped_column(Date)
    pauses_used: Mapped[int] = mapped_column(Integer, default=0)

    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Read-only copy of selected Notion fields: {"career": {...}, "academic": {...}, "billing": {...}}
    notion_snapshot: Mapped[dict | None] = mapped_column(JSON)
    notion_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payments_behind: Mapped[bool | None] = mapped_column(Boolean)  # derived from Notion billing; advisors see only this

    user: Mapped[User] = relationship(back_populates="student", foreign_keys=[user_id])
    advisor: Mapped[User | None] = relationship(foreign_keys=[advisor_id])
    cohort: Mapped[Cohort | None] = relationship()


class RuleSetting(Base):
    """Admin-editable point values and thresholds (defaults live in rules.py)."""
    __tablename__ = "rule_settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[float] = mapped_column(JSON)
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PointsEvent(TimestampMixin, Base):
    __tablename__ = "points_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(40))
    delta: Mapped[int] = mapped_column(Integer)  # the rule's value
    applied_delta: Mapped[int] = mapped_column(Integer)  # after floor/ceiling clamping
    balance_after: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(40), default="system")  # extension|manual|advisor|weekly_check|automatic
    source_id: Mapped[str | None] = mapped_column(String(36))
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    idempotency_key: Mapped[str | None] = mapped_column(String(160), unique=True)


class Application(TimestampMixin, Base):
    __tablename__ = "applications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    company: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(255))
    job_url: Mapped[str | None] = mapped_column(Text)
    # applied | phone_screen | technical | final | offer | rejected | withdrawn
    status: Mapped[str] = mapped_column(String(20), default="applied")
    # extension_linkedin | extension_indeed | extension_glassdoor | extension_greenhouse | manual
    source: Mapped[str] = mapped_column(String(30), default="manual")  # … | notion_import
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True)  # Notion page id for imported rows
    notes: Mapped[str | None] = mapped_column(Text)
    followup_date: Mapped[date | None] = mapped_column(Date)
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ActivityLog(TimestampMixin, Base):
    """Recruiter outreach, LinkedIn posts and networking actions logged by the student."""
    __tablename__ = "activity_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # outreach | linkedin_post | networking
    contact_name: Mapped[str | None] = mapped_column(String(255))
    company: Mapped[str | None] = mapped_column(String(255))
    platform: Mapped[str | None] = mapped_column(String(60))
    url: Mapped[str | None] = mapped_column(Text)
    post_type: Mapped[str | None] = mapped_column(String(20))  # original | commentary
    notes: Mapped[str | None] = mapped_column(Text)
    occurred_on: Mapped[date] = mapped_column(Date)
    points_awarded: Mapped[int] = mapped_column(Integer, default=0)
    verified_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | rejected
    rejected_reason: Mapped[str | None] = mapped_column(Text)


class ProfileTask(Base):
    __tablename__ = "profile_tasks"
    __table_args__ = (UniqueConstraint("student_id", "task"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"))
    task: Mapped[str] = mapped_column(String(20))  # cv | github | headshot | linkedin
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Session(TimestampMixin, Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    advisor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    session_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    session_type: Mapped[str] = mapped_column(String(20))  # one_on_one | group_workshop | mock_interview
    attendance: Mapped[str] = mapped_column(String(20))  # attended | rescheduled | absent | scheduled (excused = legacy)
    title: Mapped[str | None] = mapped_column(String(255))
    summary: Mapped[str | None] = mapped_column(Text)
    resources: Mapped[list] = mapped_column(JSON, default=list)
    advisor: Mapped[User | None] = relationship()
    homework: Mapped[list["HomeworkTask"]] = relationship(back_populates="session", order_by="HomeworkTask.created_at")


class HomeworkTask(TimestampMixin, Base):
    __tablename__ = "homework_tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("sessions.id"))  # None = assigned outside a session
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    assigned_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    description: Mapped[str] = mapped_column(Text)
    due_date: Mapped[date | None] = mapped_column(Date)  # None = due by the next 1:1 meeting
    point_value: Mapped[int] = mapped_column(Integer, default=15)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | completed | missed
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by_advisor: Mapped[bool] = mapped_column(Boolean, default=False)
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    session: Mapped[Session | None] = relationship(back_populates="homework")


class Notification(TimestampMixin, Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(20))  # warning | critical | success | info | reminder | deduction
    category: Mapped[str] = mapped_column(String(40))  # guarantee | deduction | advisor | reminder | session | pause
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(1000))
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    email_sent: Mapped[bool] = mapped_column(Boolean, default=False)


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("user_id", "key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    key: Mapped[str] = mapped_column(String(40))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class PauseRequest(TimestampMixin, Base):
    __tablename__ = "pause_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    reason_type: Mapped[str] = mapped_column(String(30))  # medical | family | travel | other
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | approved | declined | ended
    extension_days: Mapped[int] = mapped_column(Integer, default=0)
    decided_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False)


class OfferReport(TimestampMixin, Base):
    __tablename__ = "offer_reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"))
    application_id: Mapped[str | None] = mapped_column(ForeignKey("applications.id"))
    company: Mapped[str] = mapped_column(String(255))
    justification: Mapped[str | None] = mapped_column(Text)
    justification_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    reported_by: Mapped[str] = mapped_column(ForeignKey("users.id"))


class ResumeVersion(TimestampMixin, Base):
    __tablename__ = "resume_versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    resume_text: Mapped[str] = mapped_column(Text)
    job_description: Mapped[str] = mapped_column(Text)
    analysis: Mapped[dict] = mapped_column(JSON)
    downloaded: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditLog(TimestampMixin, Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    student_id: Mapped[str | None] = mapped_column(ForeignKey("students.id"))
    action: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)


class Interaction(TimestampMixin, Base):
    """Advisor touchpoints outside formal sessions (calls, Slack, WhatsApp, email, check-ins)."""
    __tablename__ = "interactions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    advisor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    channel: Mapped[str] = mapped_column(String(20))  # call | slack | whatsapp | email | meeting | other
    summary: Mapped[str] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(10), default="private")  # private (staff only) | shared
    follow_up_date: Mapped[date | None] = mapped_column(Date)
    follow_up_done: Mapped[bool] = mapped_column(Boolean, default=False)
    advisor: Mapped[User | None] = relationship()


class SyncRun(TimestampMixin, Base):
    __tablename__ = "sync_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    source: Mapped[str] = mapped_column(String(20), default="notion")
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    summary: Mapped[dict] = mapped_column(JSON)
    triggered_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))


class Job(TimestampMixin, Base):
    """An open opportunity (Job Radar): from Adzuna, grokbot, partners or added by hand."""
    __tablename__ = "jobs"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_job_source_ext"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    source: Mapped[str] = mapped_column(String(30))  # adzuna | grokbot | partner | manual
    external_id: Mapped[str] = mapped_column(String(255))
    url_key: Mapped[str | None] = mapped_column(String(500), index=True)  # normalized URL for cross-source dedupe
    title: Mapped[str] = mapped_column(String(255))
    company: Mapped[str | None] = mapped_column(String(255))
    location: Mapped[str | None] = mapped_column(String(255))
    work_mode: Mapped[str | None] = mapped_column(String(20))  # remote | hybrid | onsite
    url: Mapped[str | None] = mapped_column(String(1000))
    description: Mapped[str | None] = mapped_column(Text)
    program: Mapped[str | None] = mapped_column(String(30))  # full_stack | ai_engineering | data_science | cybersecurity
    country: Mapped[str | None] = mapped_column(String(2), index=True)  # ISO code: US, ES, MX, CO, VE, AR…
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    salary_min: Mapped[int | None] = mapped_column(Integer)
    salary_max: Mapped[int | None] = mapped_column(Integer)
    # outreach to the employer (grokbot or the team)
    contact_name: Mapped[str | None] = mapped_column(String(255))
    contact_handle: Mapped[str | None] = mapped_column(String(255))  # email, X handle or LinkedIn
    outreach_status: Mapped[str] = mapped_column(String(20), default="none")  # none | contacted | replied | interviewing | closed
    is_partner: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    shared_count: Mapped[int] = mapped_column(Integer, default=0)
    raw: Mapped[dict | None] = mapped_column(JSON)


class ResumeProfile(Base):
    """The student's master resume (structured), edited by the student and by staff."""
    __tablename__ = "resume_profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), unique=True)
    data: Mapped[dict] = mapped_column(JSON)
    template: Mapped[str] = mapped_column(String(20), default="classic")
    lang: Mapped[str] = mapped_column(String(5), default="en")  # language the resume is written in
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | in_review | changes_requested | approved
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # first approval unlocks downloads
    approved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ResumeSnapshot(TimestampMixin, Base):
    """A saved version: master history or a resume tailored to one job."""
    __tablename__ = "resume_snapshots"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # master | tailored
    label: Mapped[str] = mapped_column(String(255))
    data: Mapped[dict] = mapped_column(JSON)
    template: Mapped[str] = mapped_column(String(20), default="classic")
    lang: Mapped[str] = mapped_column(String(5), default="en")
    job_title: Mapped[str | None] = mapped_column(String(255))
    company: Mapped[str | None] = mapped_column(String(255))
    application_id: Mapped[str | None] = mapped_column(ForeignKey("applications.id"))
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id"))
    analysis: Mapped[dict | None] = mapped_column(JSON)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    downloads: Mapped[int] = mapped_column(Integer, default=0)


class ResumeComment(TimestampMixin, Base):
    __tablename__ = "resume_comments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    section: Mapped[str | None] = mapped_column(String(40))
    body: Mapped[str] = mapped_column(Text)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)


class AiUsage(TimestampMixin, Base):
    """Every server-side AI call (staff only), for the monthly budget."""
    __tablename__ = "ai_usage"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    student_id: Mapped[str | None] = mapped_column(ForeignKey("students.id"))
    kind: Mapped[str] = mapped_column(String(30))
    model: Mapped[str] = mapped_column(String(80))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0)


class ResumeTemplate(TimestampMixin, Base):
    """Example resumes staff curate; students start from them ("Start from a template")."""
    __tablename__ = "resume_templates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    program: Mapped[str | None] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(String(400))
    data: Mapped[dict] = mapped_column(JSON)
    layout: Mapped[str] = mapped_column(String(20), default="classic")  # classic | modern | technical
    lang: Mapped[str] = mapped_column(String(5), default="en")
    active: Mapped[bool] = mapped_column(Boolean, default=True)  # visible to students
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class JobShare(TimestampMixin, Base):
    """A Job Radar job an advisor shared with one student; the student sees it in "Jobs for you"."""
    __tablename__ = "job_shares"
    __table_args__ = (UniqueConstraint("job_id", "student_id", name="uq_job_share"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"), index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    shared_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="new")  # new | interested | applied | not_a_fit
    response_note: Mapped[str | None] = mapped_column(String(500))
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    application_id: Mapped[str | None] = mapped_column(ForeignKey("applications.id"))

    job: Mapped["Job"] = relationship()


class JobShareEvent(TimestampMixin, Base):
    """Timeline of a shared job: shared, seen, interested, applied, not a fit, interview stages, advisor notes."""
    __tablename__ = "job_share_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    share_id: Mapped[str] = mapped_column(ForeignKey("job_shares.id", ondelete="CASCADE"), index=True)
    # shared | seen | interested | applied | not_a_fit | reopened | stage | note
    kind: Mapped[str] = mapped_column(String(20))
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    detail: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)



class AutomationConnection(TimestampMixin, Base):
    """An n8n instance the hub can read (workflows, executions) with an n8n API key."""
    __tablename__ = "automation_connections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20), default="n8n")
    base_url: Mapped[str] = mapped_column(String(500))
    api_key: Mapped[str | None] = mapped_column(Text)  # never returned by the API
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))


class Automation(TimestampMixin, Base):
    """A workflow the hub knows about: run it from a button, fire it on hub events, and/or receive its results."""
    __tablename__ = "automations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(60))
    connection_id: Mapped[str | None] = mapped_column(ForeignKey("automation_connections.id", ondelete="SET NULL"))
    n8n_workflow_id: Mapped[str | None] = mapped_column(String(64))
    link: Mapped[str | None] = mapped_column(String(500))
    webhook_url: Mapped[str | None] = mapped_column(String(1000))  # n8n Webhook node URL, for "Run" and events
    secret: Mapped[str | None] = mapped_column(String(120))  # sent as X-GeekForce-Secret; also checks callbacks
    events: Mapped[list | None] = mapped_column(JSON)  # hub events that fire it
    scope: Mapped[str] = mapped_column(String(20), default="none")  # none | student | cohort | job
    allow_advisors: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    schedule_note: Mapped[str | None] = mapped_column(String(200))  # e.g. "Daily 8:00 in n8n"
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status: Mapped[str | None] = mapped_column(String(20))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))


class AutomationRun(TimestampMixin, Base):
    __tablename__ = "automation_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    automation_id: Mapped[str] = mapped_column(ForeignKey("automations.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(20))  # manual | event | callback | test
    status: Mapped[str] = mapped_column(String(20))  # ok | error | received
    triggered_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    event: Mapped[str | None] = mapped_column(String(60))
    context: Mapped[dict | None] = mapped_column(JSON)  # who/what it ran for, params
    http_status: Mapped[int | None] = mapped_column(Integer)
    response: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int | None] = mapped_column(Integer)


class Dashboard(TimestampMixin, Base):
    __tablename__ = "dashboards"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(String(500))
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    shared: Mapped[bool] = mapped_column(Boolean, default=False)  # visible to all staff
    filters: Mapped[dict | None] = mapped_column(JSON)  # dashboard-wide filters (dates, cohort, advisor…)
    position: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    widgets: Mapped[list["DashboardWidget"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)


class DashboardWidget(TimestampMixin, Base):
    __tablename__ = "dashboard_widgets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    dashboard_id: Mapped[str] = mapped_column(ForeignKey("dashboards.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    config: Mapped[dict] = mapped_column(JSON)  # dataset, metric, group_by, series_by, chart, filters, limit
    position: Mapped[int] = mapped_column(Integer, default=0)
    width: Mapped[int] = mapped_column(Integer, default=2)  # columns out of 4
