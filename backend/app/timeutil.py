"""Time helpers. Everything is stored in UTC; weeks and cron schedules use settings.timezone."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .config import settings

UTC = timezone.utc


def tz() -> ZoneInfo:
    return ZoneInfo(settings.timezone)


def now_utc() -> datetime:
    return datetime.now(UTC)


def aware(dt: datetime | None) -> datetime | None:
    """Treat naive datetimes (e.g. from SQLite) as UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def local_today(ref: datetime | None = None) -> date:
    return aware(ref or now_utc()).astimezone(tz()).date()


def week_start(ref: datetime | None = None) -> date:
    """Monday (local) of the week containing ref."""
    d = local_today(ref)
    return d - timedelta(days=d.weekday())


def local_midnight_utc(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=tz()).astimezone(UTC)


def week_bounds_utc(monday: date) -> tuple[datetime, datetime]:
    return local_midnight_utc(monday), local_midnight_utc(monday + timedelta(days=7))
