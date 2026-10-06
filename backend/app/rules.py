"""Career Points rules — defaults from the GeekForce Career Points Policy v1.0 (March 2026).

Every value is editable by admins (Admin → Rules & points) and stored in `rule_settings`;
anything not overridden falls back to these defaults.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import RuleSetting

# key: (default, label, group)
RULES: dict[str, tuple[float, str, str]] = {
    # Thresholds
    "starting_points": (80, "Starting points", "thresholds"),
    "secured_threshold": (80, "Secured at or above", "thresholds"),
    "suspended_below": (60, "Suspended below", "thresholds"),
    "points_floor": (0, "Floor", "thresholds"),
    "points_ceiling": (100, "Ceiling", "thresholds"),
    "weekly_application_target": (15, "Applications per week · Job Guarantee", "thresholds"),
    "weekly_target_prof_support": (10, "Applications per week · Professional Support", "thresholds"),
    "max_missed_meetings": (3, "Max missed meetings (whole program)", "thresholds"),
    "max_pause_days": (30, "Max pause (days)", "thresholds"),
    "pauses_per_cycle": (1, "Pauses per program cycle", "thresholds"),
    "pause_deadline_multiplier": (1.5, "Deadline extension multiplier", "thresholds"),
    "default_deadline_days": (180, "Default job search deadline (days)", "thresholds"),
    "inactivity_days": (30, "Inactive after (days)", "thresholds"),
    "inactivity_warning_day": (25, "Inactivity warning on day", "thresholds"),
    "linkedin_inactive_days": (14, "LinkedIn inactivity window (days)", "thresholds"),
    "not_started_followup_day": (7, "Not Started: follow-up on day", "thresholds"),
    "not_started_hold_day": (15, "Not Started: put on hold on day", "thresholds"),
    "not_started_loss_day": (30, "Not Started: guarantee lost on day", "thresholds"),
    "outreach_inactive_days": (14, "Outreach inactivity window (days)", "thresholds"),
    # Earn
    "pts_application": (3, "Job application", "earn"),
    "pts_weekly_bonus": (10, "Weekly goal met (bonus)", "earn"),
    "pts_meeting_attended": (20, "Advisor 1:1 attended", "earn"),
    "pts_session_attended": (10, "GeekForce session attended", "earn"),
    "pts_mock_interview": (10, "Mock interview completed", "earn"),
    "pts_homework": (15, "Homework done on time", "earn"),
    "pts_linkedin_post": (5, "LinkedIn post", "earn"),
    "cap_linkedin_posts_week": (3, "LinkedIn posts that earn points per week", "earn"),
    "pts_outreach": (5, "Recruiter outreach", "earn"),
    "cap_outreach_week": (5, "Outreach messages that earn points per week", "earn"),
    "pts_project": (20, "Project submitted to advisor", "earn"),
    "pts_profile_task": (5, "Profile task (one-time each)", "earn"),
    "pts_networking": (10, "Networking action", "earn"),
    "pts_resume_download": (0, "Tailored resume downloaded", "earn"),
    "cap_resume_downloads_week": (3, "Resume downloads that earn points per week", "earn"),
    # Lose
    "ded_weekly_target_missed": (-10, "Week ends under target", "lose"),
    "ded_session_missed": (-10, "Session missed without 24h notice", "lose"),
    "ded_homework_missed": (-15, "Homework not done by meeting", "lose"),
    "ded_homework_streak": (-10, "Homework missed 2 meetings in a row (extra)", "lose"),
    "ded_linkedin_inactive": (-10, "No LinkedIn activity in window", "lose"),
    "ded_outreach_inactive": (-10, "No recruiter outreach in window", "lose"),
    "ded_offer_rejected": (-30, "Valid offer rejected without justification", "lose"),
    "ded_inactivity_initial": (-20, "Inactive past limit (first deduction)", "lose"),
    "ded_inactivity_weekly": (-10, "Each further inactive week", "lose"),
}

DEFAULTS = {k: v[0] for k, v in RULES.items()}


class Rules(dict):
    def __getattr__(self, item):
        try:
            v = self[item]
        except KeyError as e:
            raise AttributeError(item) from e
        return int(v) if float(v).is_integer() else float(v)


def get_rules(db: Session) -> Rules:
    values = dict(DEFAULTS)
    for row in db.scalars(select(RuleSetting)):
        if row.key in values:
            values[row.key] = row.value
    return Rules(values)


def rules_catalog(db: Session) -> list[dict]:
    current = get_rules(db)
    return [
        {"key": k, "label": label, "group": group, "value": current[k], "default": default}
        for k, (default, label, group) in RULES.items()
    ]
