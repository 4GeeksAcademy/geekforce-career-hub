"""Points engine tests — one per rule in the Career Points Policy."""
from datetime import timedelta

from sqlalchemy import select

from app import engine
from app.jobs import daily, weekly_check
from app.models import Application, HomeworkTask, Notification, PointsEvent, Session, Student
from app.timeutil import local_today, now_utc


def _app(db, people, n=1, days_ago=0, url=None):
    st, u = people["student"], people["student_user"]
    for i in range(n):
        a, _ = engine.record_application(db, st, company=f"Co{i}", role="Dev", job_url=url or f"https://x/{i}-{days_ago}",
                                         source="manual", notes=None, user=u)
        if days_ago:
            a.applied_at = now_utc() - timedelta(days=days_ago)
    db.commit()


def test_application_awards_three_and_status_transitions(db, people):
    st = people["student"]
    st.career_points, st.guarantee_status = 77, "at_risk"
    db.commit()
    _app(db, people)
    assert st.career_points == 80
    assert st.guarantee_status == "secured"
    n = db.scalar(select(Notification).where(Notification.title.like("%secured again%")))
    assert n is not None


def test_duplicate_application_url_ignored(db, people):
    _app(db, people, url="https://jobs/1")
    _app(db, people, url="https://jobs/1")
    assert db.query(Application).count() == 1
    assert people["student"].career_points == 83


def test_ceiling_and_floor(db, people):
    st = people["student"]
    st.career_points = 99
    db.commit()
    _app(db, people)
    assert st.career_points == 100
    ev = db.scalar(select(PointsEvent).order_by(PointsEvent.created_at.desc()))
    assert ev.delta == 3 and ev.applied_delta == 1
    st.career_points = 5
    engine.manual_adjustment(db, st, people["advisor"], -30, "Test floor clamp")
    assert st.career_points == 0


def test_drop_below_60_suspends_and_alerts_advisor(db, people):
    st = people["student"]
    st.career_points, st.guarantee_status = 65, "at_risk"
    db.commit()
    engine.manual_adjustment(db, st, people["advisor"], -10, "Test suspension")
    db.commit()
    assert st.guarantee_status == "suspended"
    assert db.scalar(select(Notification).where(Notification.user_id == people["advisor"].id)) is not None


def test_linkedin_posts_capped_at_three_per_week(db, people):
    st, u = people["student"], people["student_user"]
    for _ in range(4):
        engine.log_activity(db, st, kind="linkedin_post", user=u, occurred_on=local_today(), post_type="original")
    db.commit()
    assert st.career_points == 80 + 15


def test_outreach_capped_at_five_per_week(db, people):
    st, u = people["student"], people["student_user"]
    for _ in range(6):
        engine.log_activity(db, st, kind="outreach", user=u, occurred_on=local_today(), contact_name="A", company="B")
    db.commit()
    assert st.career_points == 100  # 80 + 25 capped at ceiling → 100


def _homework(db, people, due_days=-1):
    st = people["student"]
    s = Session(student_id=st.id, advisor_id=people["advisor"].id, session_date=now_utc() - timedelta(days=7),
                session_type="one_on_one", attendance="attended")
    db.add(s)
    db.flush()
    t = HomeworkTask(session_id=s.id, student_id=st.id, description="Do the thing",
                     due_date=local_today() + timedelta(days=due_days))
    db.add(t)
    db.commit()
    return t


def test_session_homework_miss_and_streak(db, people):
    st, adv = people["student"], people["advisor"]
    _homework(db, people)
    engine.log_session(db, st, adv, session_type="one_on_one", attendance="attended", session_date=now_utc(),
                       title=None, summary="Notes", resources=[], new_homework=[{"description": "Next task"}],
                       completed_task_ids=set())
    db.commit()
    assert st.career_points == 80 + 20 - 15
    assert st.consecutive_homework_misses == 1
    # second consecutive miss → extra −10
    t2 = db.scalar(select(HomeworkTask).where(HomeworkTask.description == "Next task"))
    t2.due_date = local_today()
    db.commit()
    engine.log_session(db, st, adv, session_type="one_on_one", attendance="attended", session_date=now_utc(),
                       title=None, summary=None, resources=[], new_homework=[], completed_task_ids=set())
    db.commit()
    assert st.consecutive_homework_misses == 2
    assert st.career_points == 100 - 15 - 10  # 85 + 20 is capped at the 100 ceiling first


def test_completed_homework_resets_streak(db, people):
    st, adv = people["student"], people["advisor"]
    st.consecutive_homework_misses = 1
    t = _homework(db, people)
    engine.complete_homework(db, st, t, people["student_user"])
    db.commit()
    assert st.career_points == 95
    t2 = _homework(db, people)
    engine.log_session(db, st, adv, session_type="one_on_one", attendance="attended", session_date=now_utc(),
                       title=None, summary=None, resources=[], new_homework=[], completed_task_ids={t2.id})
    db.commit()
    assert st.consecutive_homework_misses == 0
    assert st.career_points == 100  # 95 + 15 (confirmed) + 20 → capped


def test_preview_matches_actual(db, people):
    st, adv = people["student"], people["advisor"]
    st.consecutive_homework_misses = 1
    st.career_points = 74
    db.commit()
    _homework(db, people)
    plan = engine.plan_session(db, st, session_type="one_on_one", attendance="attended", session_date=now_utc())
    assert plan.balance_after == 74 + 20 - 15 - 10 == 69
    engine.log_session(db, st, adv, session_type="one_on_one", attendance="attended", session_date=now_utc(),
                       title=None, summary=None, resources=[], new_homework=[], completed_task_ids=set())
    db.commit()
    assert st.career_points == plan.balance_after


def test_absence_and_missed_meeting_limit(db, people):
    st, adv = people["student"], people["advisor"]
    st.missed_meetings = 2
    db.commit()
    engine.log_session(db, st, adv, session_type="group_workshop", attendance="absent", session_date=now_utc(),
                       title=None, summary=None, resources=[], new_homework=[], completed_task_ids=set())
    db.commit()
    assert st.career_points == 70 and st.missed_meetings == 3
    assert db.scalar(select(Notification).where(Notification.title == "Missed-meeting limit reached"))


def test_excused_absence_costs_nothing(db, people):
    st, adv = people["student"], people["advisor"]
    engine.log_session(db, st, adv, session_type="one_on_one", attendance="excused", session_date=now_utc(),
                       title=None, summary=None, resources=[], new_homework=[], completed_task_ids=set())
    db.commit()
    assert st.career_points == 80 and st.missed_meetings == 0


def test_weekly_check_bonus_deduction_idempotent(db, people):
    st = people["student"]
    today = local_today()
    monday = today - timedelta(days=today.weekday())
    last_week_mid = (monday - timedelta(days=4))
    days_ago = (today - last_week_mid).days
    _app(db, people, n=12, days_ago=days_ago)  # +36 → 100 (capped)
    st.career_points = 80
    db.commit()
    weekly_check(db, today=monday)
    weekly_check(db, today=monday)  # re-run must not double-charge
    assert st.career_points == 70
    # 15 apps → bonus
    _app(db, people, n=3, days_ago=days_ago)
    db.execute(PointsEvent.__table__.delete().where(PointsEvent.event_type == "deduction_weekly"))
    st.career_points = 80
    db.commit()
    weekly_check(db, today=monday)
    assert st.career_points == 90


def test_pause_freezes_deductions_and_extends_deadline(db, people):
    st, adv = people["student"], people["advisor"]
    pr = engine.request_pause(db, st, start_date=local_today(), end_date=local_today() + timedelta(days=19),
                              reason_type="medical", reason="Surgery")
    db.commit()
    engine.decide_pause(db, pr, adv, True, None)
    db.commit()
    assert st.deadline_extension_days == 30
    assert engine.deadline_info(db, st)["total_days"] == 120
    engine.log_session(db, st, adv, session_type="one_on_one", attendance="absent", session_date=now_utc(),
                       title=None, summary=None, resources=[], new_homework=[], completed_task_ids=set())
    weekly_check(db, today=local_today() - timedelta(days=local_today().weekday()))
    db.commit()
    assert st.career_points == 80
    # second pause not allowed
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        engine.request_pause(db, st, start_date=local_today() + timedelta(days=40),
                             end_date=local_today() + timedelta(days=45), reason_type="travel", reason=None)


def test_offer_rejection(db, people):
    st, adv = people["student"], people["advisor"]
    engine.report_offer_rejection(db, st, adv, company="Globant", application_id=None, justification="Low pay",
                                  approved=True)
    assert st.career_points == 80
    engine.report_offer_rejection(db, st, adv, company="Accenture", application_id=None, justification=None,
                                  approved=False)
    assert st.career_points == 50 and st.guarantee_status == "suspended"


def test_inactivity_day_31(db, people):
    st = people["student"]
    st.job_search_start_date = local_today() - timedelta(days=100)
    st.last_activity_at = now_utc() - timedelta(days=31)
    db.commit()
    daily(db, today=local_today())
    events = [e.event_type for e in db.scalars(select(PointsEvent))]
    assert "deduction_inactivity" in events
    assert -20 in [e.delta for e in db.scalars(select(PointsEvent).where(PointsEvent.event_type == "deduction_inactivity"))]
    daily(db, today=local_today())  # idempotent
    assert len([e for e in db.scalars(select(PointsEvent).where(PointsEvent.event_type == "deduction_inactivity"))]) == 1


def test_linkedin_window(db, people):
    st = people["student"]
    st.job_search_start_date = local_today() - timedelta(days=15)
    st.last_activity_at = now_utc()
    db.commit()
    daily(db, today=local_today())
    types = [e.event_type for e in db.scalars(select(PointsEvent))]
    assert "deduction_linkedin" in types and "deduction_outreach" in types
    assert st.career_points == 60
