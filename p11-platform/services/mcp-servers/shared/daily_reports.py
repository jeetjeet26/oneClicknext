"""Bounded reporting periods in the advertising account's local calendar."""
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class ReportValidationError(ValueError):
    """A safe, actionable validation message that may be shown in import status."""


def account_timezone(value):
    try:
        return ZoneInfo(value)
    except (TypeError, ValueError, ZoneInfoNotFoundError):
        raise ReportValidationError('Advertising account timezone is missing or invalid') from None


DATE_RANGES = frozenset({
    'TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS',
    'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH',
})


def account_id(value: str, platform: str) -> str:
    value = str(value).strip()
    if platform == 'google_ads':
        value = value.replace('-', '')
        pattern = r'[0-9]{10}'
    elif platform == 'meta_ads':
        value = value.removeprefix('act_')
        pattern = r'[0-9]+'
    else:
        raise ReportValidationError('Unsupported advertising platform')
    if not re.fullmatch(pattern, value):
        raise ReportValidationError('Invalid advertising account identifier')
    return value


def iso_day(value: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise ReportValidationError('A daily report date is missing or invalid')
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ReportValidationError('A daily report date is invalid') from None


def reporting_window(preset: str, timezone_name: str, now: datetime | None = None) -> tuple[str, str]:
    if preset not in DATE_RANGES:
        raise ReportValidationError('Unsupported date range; choose a bounded reporting period')
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ReportValidationError('Reporting clock must include a timezone')
    today = now.astimezone(account_timezone(timezone_name)).date()
    if preset == 'TODAY':
        start = end = today
    elif preset == 'YESTERDAY':
        start = end = today - timedelta(days=1)
    elif preset.startswith('LAST_') and preset.endswith('_DAYS'):
        end = today - timedelta(days=1)
        start = today - timedelta(days=int(preset.split('_')[1]))
    elif preset == 'THIS_MONTH':
        start, end = today.replace(day=1), today
    else:
        end = today.replace(day=1) - timedelta(days=1)
        start = end.replace(day=1)
    return start.isoformat(), end.isoformat()
