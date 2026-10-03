"""Validate a complete provider report before it can become BI fact rows."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from shared.daily_reports import ReportValidationError, account_id, account_timezone, iso_day


def number(value, field: str) -> Decimal:
    try:
        if value is None or isinstance(value, bool):
            raise ReportValidationError()
        parsed = Decimal(str(value))
        if not parsed.is_finite() or parsed < 0:
            raise ReportValidationError()
        return parsed
    except (ValueError, InvalidOperation):
        raise ReportValidationError(f'Daily report has an invalid {field}') from None


def whole_count(value, field: str) -> int:
    parsed = number(value, field)
    if parsed != parsed.to_integral_value():
        raise ReportValidationError(f'Daily {field} contains fractional attribution; the current reporting table requires whole counts. Schema reconciliation is required.')
    if parsed > 9_223_372_036_854_775_807:
        raise ReportValidationError(f'Daily {field} exceeds reporting storage limits')
    return int(parsed)


def report_records(report: dict, property_id: str, platform: str, requested_account: str) -> list[dict]:
    expected = account_id(requested_account, platform)
    if not isinstance(report, dict) or report.get('account_id') != expected:
        raise ReportValidationError('Daily report account does not match the connected account')
    # The existing BI/export contract displays USD and has no currency dimension.
    if report.get('currency') != 'USD':
        raise ReportValidationError('This report is not confirmed in USD. Currency-aware reporting is required before importing this account.')
    account_timezone(report.get('timezone'))
    start, end = iso_day(report.get('start_date')), iso_day(report.get('end_date'))
    if start > end or (end - start).days > 30:
        raise ReportValidationError('Daily report period is invalid or exceeds the requested import limits')
    if not isinstance(report.get('rows'), list):
        raise ReportValidationError('Daily report rows were not confirmed')
    records, seen = [], set()
    for row in report['rows']:
        if not isinstance(row, dict) or row.get('account_id') != expected or row.get('currency') != report['currency']:
            raise ReportValidationError('A daily report row has an unexpected account or currency')
        day = iso_day(row.get('date'))
        if iso_day(row.get('date_stop')) != day:
            raise ReportValidationError('A multi-day total cannot be imported as a daily report row')
        if not start <= day <= end:
            raise ReportValidationError('A daily report row falls outside the requested dates')
        campaign_id = row.get('campaign_id')
        if not isinstance(campaign_id, str) or not campaign_id.isascii() or not campaign_id.isdecimal():
            raise ReportValidationError('A daily report row has no valid campaign identifier')
        key = (day, campaign_id)
        if key in seen:
            raise ReportValidationError('Duplicate campaign/day rows make this report ambiguous')
        seen.add(key)
        if platform == 'meta_ads':
            actions = row.get('actions')
            if not isinstance(actions, list) or any(not isinstance(action, dict) for action in actions):
                raise ReportValidationError('Meta conversion actions were not confirmed')
            # Preserve the existing KPI definition; do not add overlapping aliases.
            conversions = Decimal(0)
            action_types = set()
            for action in actions:
                kind = action.get('action_type')
                if kind in {'lead', 'complete_registration', 'purchase'}:
                    if kind in action_types:
                        raise ReportValidationError('Duplicate Meta conversion action types')
                    action_types.add(kind)
                    conversions += number(action.get('value'), 'conversions')
        else:
            conversions = row.get('conversions')
        if number(conversions, 'conversions') >= Decimal('1000000000000000'):
            raise ReportValidationError('Daily conversions exceed reporting storage limits')
        spend = number(row.get('spend'), 'spend').quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        if spend >= Decimal('100000000'):
            raise ReportValidationError('Daily spend exceeds reporting storage limits')
        records.append({
            'date': day.isoformat(), 'property_id': property_id, 'channel_id': platform,
            'campaign_id': campaign_id, 'campaign_name': row.get('campaign_name') or 'Unnamed campaign',
            'spend': float(spend), 'clicks': whole_count(row.get('clicks'), 'clicks'),
            'impressions': whole_count(row.get('impressions'), 'impressions'),
            'conversions': float(number(conversions, 'conversions')), 'raw_source': 'mcp_daily_v1',
            'source_account_id': expected, 'currency_code': report['currency'],
        })
    return records
