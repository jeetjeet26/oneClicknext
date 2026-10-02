"""Daily provider contract fixtures; every network/client boundary is replaced."""
import asyncio
import json
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
from pipelines import mcp_marketing_sync as pipeline  # Installs the MCP shared module path.
from pipelines.marketing_report import report_records
from shared import daily_reports as daily
from google_ads.tools import performance as google
from google_ads import config as google_config
from meta_ads.client import MetaAdsClient
from test_marketing_import import MemoryDatabase, PROPERTY, JOB, accept, db  # noqa: F401

ACCOUNT = '1234567890'
NOW = datetime(2026, 9, 14, 2, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def freeze_report_clock(monkeypatch):
    original = daily.reporting_window
    monkeypatch.setattr(daily, 'reporting_window', lambda preset, tz, now=None: original(preset, tz, now or NOW))


@pytest.mark.parametrize('preset,tz,now,expected', [
    ('TODAY', 'America/Los_Angeles', NOW, ('2026-09-13', '2026-09-13')),
    ('YESTERDAY', 'Asia/Tokyo', NOW, ('2026-09-13', '2026-09-13')),
    ('LAST_7_DAYS', 'America/Los_Angeles', NOW, ('2026-09-06', '2026-09-12')),
    ('LAST_14_DAYS', 'UTC', NOW, ('2026-08-31', '2026-09-13')),
    ('LAST_30_DAYS', 'UTC', NOW, ('2026-08-15', '2026-09-13')),
    ('THIS_MONTH', 'UTC', NOW, ('2026-09-01', '2026-09-14')),
    ('LAST_MONTH', 'UTC', NOW, ('2026-08-01', '2026-08-31')),
    ('LAST_MONTH', 'UTC', datetime(2024, 3, 1, tzinfo=timezone.utc), ('2024-02-01', '2024-02-29')),
    ('LAST_MONTH', 'UTC', datetime(2026, 1, 1, tzinfo=timezone.utc), ('2025-12-01', '2025-12-31')),
    ('LAST_7_DAYS', 'America/Los_Angeles', datetime(2026, 3, 9, 7, tzinfo=timezone.utc), ('2026-03-02', '2026-03-08')),
])
def test_provider_calendar_boundaries(preset, tz, now, expected):
    assert daily.reporting_window(preset, tz, now) == expected


@pytest.mark.parametrize('preset,tz', [('MAXIMUM', 'UTC'), ('typo', 'UTC'), ('TODAY', ''), ('TODAY', None), ('TODAY', 'Invalid/Timezone')])
def test_unsupported_period_or_timezone_is_not_replaced_with_all_history(preset, tz):
    with pytest.raises(daily.ReportValidationError): daily.reporting_window(preset, tz)


def report(rows=None):
    return {'account_id': ACCOUNT, 'currency': 'USD', 'timezone': 'UTC',
            'start_date': '2026-09-07', 'end_date': '2026-09-13', 'rows': rows if rows is not None else [row()]}


def row(day='2026-09-07', campaign='100', **changes):
    return {'account_id': ACCOUNT, 'currency': 'USD', 'date': day, 'date_stop': day,
            'campaign_id': campaign, 'campaign_name': 'Daily fixture', 'spend': '12.345',
            'clicks': '2', 'impressions': '100', 'conversions': 1, 'actions': [], **changes}


def test_two_days_stay_distinct_and_currency_is_converted_only_once():
    rows = report_records(report([row(), row('2026-09-08', spend='7.20')]), PROPERTY, 'google_ads', '123-456-7890')
    assert [r['date'] for r in rows] == ['2026-09-07', '2026-09-08']
    assert [r['spend'] for r in rows] == [12.35, 7.2]
    assert all(r['raw_source'] == 'mcp_daily_v1' for r in rows)


@pytest.mark.parametrize('changes,reason', [
    ({'date': None}, 'date'), ({'date': '2026-02-30'}, 'date'),
    ({'date_stop': '2026-09-13'}, 'multi-day'), ({'date': '2026-09-06', 'date_stop': '2026-09-06'}, 'outside'),
    ({'campaign_id': ''}, 'campaign'), ({'campaign_id': '١٢٣'}, 'campaign'),
    ({'account_id': '9999999999'}, 'account'), ({'currency': 'CAD'}, 'currency'),
    ({'spend': 'NaN'}, 'spend'), ({'spend': 'Infinity'}, 'spend'), ({'spend': '-1'}, 'spend'),
    ({'spend': None}, 'spend'), ({'spend': '100000000'}, 'storage'),
    ({'clicks': '1.5'}, 'fractional'), ({'clicks': True}, 'clicks'),
    ({'impressions': '9223372036854775808'}, 'storage'),
    ({'conversions': '1000000000000000'}, 'storage'), ({'conversions': None}, 'conversions'),
])
def test_invalid_row_rejects_the_whole_account_before_storage(changes, reason):
    with pytest.raises(daily.ReportValidationError, match=reason):
        report_records(report([row(), row('2026-09-08', **changes)]), PROPERTY, 'google_ads', ACCOUNT)


@pytest.mark.parametrize('changes', [{'account_id': '999'}, {'currency': 'CAD'}, {'currency': None}, {'timezone': None}, {'rows': None}, {'start_date': '2025-01-01'}])
def test_invalid_or_non_usd_report_is_not_a_successful_empty_import(changes):
    with pytest.raises(daily.ReportValidationError): report_records({**report([]), **changes}, PROPERTY, 'google_ads', ACCOUNT)


def test_repeated_campaign_day_fails_instead_of_last_row_winning():
    with pytest.raises(daily.ReportValidationError, match='Duplicate'):
        report_records(report([row(), row(spend='99')]), PROPERTY, 'google_ads', ACCOUNT)


def test_meta_uses_existing_kpi_definition_without_double_counting_aliases():
    actions = [{'action_type': 'lead', 'value': '2'}, {'action_type': 'purchase', 'value': '3'},
               {'action_type': 'complete_registration', 'value': '1'}, {'action_type': 'omni_purchase', 'value': '3'}]
    result = report_records(report([row(actions=actions)]), PROPERTY, 'meta_ads', 'act_' + ACCOUNT)
    assert result[0]['conversions'] == 6 and result[0]['spend'] == 12.35


@pytest.mark.parametrize('actions', [None, [None], [{'action_type': 'lead', 'value': 'NaN'}], [{'action_type': 'lead', 'value': '1'}, {'action_type': 'lead', 'value': '2'}]])
def test_meta_invalid_actions_are_explicit(actions):
    with pytest.raises(daily.ReportValidationError): report_records(report([row(actions=actions)]), PROPERTY, 'meta_ads', ACCOUNT)


def google_row(campaign='100', day='2026-09-07'):
    return NS(customer=NS(id=int(ACCOUNT), currency_code='USD', time_zone='UTC'),
              campaign=NS(id=int(campaign), name='Daily fixture'), segments=NS(date=day),
              metrics=NS(cost_micros=12345000, impressions=100, clicks=2, conversions=1))


def google_service(monkeypatch, fail_late=False):
    calls, consumed = [], []
    def search(*, customer_id, query, timeout):
        calls.append((customer_id, query, timeout))
        if 'FROM customer' in query: return [google_row()]
        def pages():
            for offset in range(0, 205, 100):
                consumed.append(offset)
                if fail_late and offset == 200: raise RuntimeError('fixture late page unavailable')
                yield from (google_row(str(1000 + i)) for i in range(offset, min(offset + 100, 205)))
        return pages()
    monkeypatch.setattr(google, 'get_client', lambda: NS(get_service=lambda _: NS(search=search)))
    return calls, consumed


def test_google_reads_all_pages_daily_and_uses_supported_search_arguments(monkeypatch):
    calls, consumed = google_service(monkeypatch)
    result = asyncio.run(google.get_daily_campaign_performance('123-456-7890', 'LAST_7_DAYS'))
    assert len(result['rows']) == 205 and consumed == [0, 100, 200]
    assert result['rows'][0]['spend'] == '12.345'
    query = calls[1][1]
    assert 'segments.date' in query and 'LIMIT' not in query
    assert "BETWEEN '2026-09-07' AND '2026-09-13'" in query
    assert all(call[0] == ACCOUNT for call in calls)


def test_google_manager_identity_belongs_in_client_configuration(monkeypatch):
    for name in ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET']:
        monkeypatch.setattr(google_config, name, 'fixture-only')
    monkeypatch.setattr(google_config, 'GOOGLE_ADS_CUSTOMER_ID', '9876543210')
    assert google_config.get_google_ads_config()['login_customer_id'] == '9876543210'


def meta_client(monkeypatch, pages):
    # Explicit token bypasses the host's token cache; _get is always replaced.
    client = MetaAdsClient(access_token='fixture-only', account_id=ACCOUNT)
    calls = []
    async def get(endpoint, params):
        calls.append((endpoint, deepcopy(params)))
        if not endpoint.endswith('/insights'):
            return {'account_id': ACCOUNT, 'currency': 'USD', 'timezone_name': 'UTC'}
        page = pages.pop(0)
        if isinstance(page, Exception): raise page
        return page
    monkeypatch.setattr(client, '_get', get)
    return client, calls


def meta_row(day='2026-09-07', campaign='100'):
    return {'account_id': ACCOUNT, 'account_currency': 'USD', 'date_start': day, 'date_stop': day,
            'campaign_id': campaign, 'campaign_name': 'Meta fixture', 'spend': '5.50', 'clicks': '3', 'impressions': '20'}


def test_meta_follows_cursors_on_same_account_and_explicit_daily_dates(monkeypatch):
    client, calls = meta_client(monkeypatch, [
        {'data': [meta_row(campaign=str(100 + i)) for i in range(100)], 'paging': {'next': 'https://untrusted.invalid/?access_token=do-not-follow', 'cursors': {'after': 'page2'}}},
        {'data': [meta_row('2026-09-08')], 'paging': {'cursors': {'after': 'terminal'}}},
    ])
    result = asyncio.run(client.get_daily_campaign_insights('act_' + ACCOUNT, 'LAST_7_DAYS'))
    assert len(result['rows']) == 101
    assert all(endpoint == f'/act_{ACCOUNT}/insights' for endpoint, _ in calls[1:])
    assert calls[1][1]['time_increment'] == 1
    assert json.loads(calls[1][1]['time_range']) == {'since': '2026-09-07', 'until': '2026-09-13'}
    assert 'date_preset' not in calls[1][1] and calls[2][1]['after'] == 'page2'
    assert report_records(result, PROPERTY, 'meta_ads', ACCOUNT)[-1]['spend'] == 5.5


@pytest.mark.parametrize('pages', [
    [{'data': []}, {'data': None}],
    [{'data': [], 'paging': {'next': 'next'}}],
    [{'data': [], 'paging': {'next': 'next', 'cursors': {'after': 'loop'}}}] * 2,
    [{'data': None}], [{'error': {'message': 'fixture'}}], [{'data': [], 'paging': None}],
    [{'data': [None]}],
])
def test_meta_incomplete_or_invalid_paging_fails(monkeypatch, pages):
    if len(pages) == 2 and pages[0] == {'data': []}:
        pages[0]['paging'] = {'next': 'next', 'cursors': {'after': 'next'}}
    client, _ = meta_client(monkeypatch, deepcopy(pages))
    with pytest.raises(daily.ReportValidationError): asyncio.run(client.get_daily_campaign_insights(ACCOUNT, 'LAST_7_DAYS'))


def test_google_late_page_failure_does_not_write_first_pages_or_advance_freshness(db, monkeypatch):
    google_service(monkeypatch, fail_late=True)
    monkeypatch.setattr(pipeline, '_get_google_ads_tools', lambda: (google.get_daily_campaign_performance, lambda value: value))
    db.rows['ad_account_connections'][0]['account_id'] = ACCOUNT
    accept()
    sync = pipeline.MCPMarketingSync(JOB)
    assert asyncio.run(sync.sync_property(PROPERTY, ['google_ads'], 'LAST_7_DAYS')) == []
    assert db.rows['import_jobs'][0]['status'] == 'failed'
    assert db.rows['fact_marketing_performance'] == []
    assert 'last_imported_at' not in db.rows['ad_account_connections'][0]


def test_daily_rows_reach_import_job_with_preserved_dates(db, monkeypatch):
    google_service(monkeypatch)
    monkeypatch.setattr(pipeline, '_get_google_ads_tools', lambda: (google.get_daily_campaign_performance, lambda value: value))
    db.rows['ad_account_connections'][0]['account_id'] = ACCOUNT
    accept()
    records = asyncio.run(pipeline.MCPMarketingSync(JOB).sync_property(PROPERTY, ['google_ads'], 'LAST_7_DAYS'))
    assert len(records) == 205
    assert db.rows['import_jobs'][0]['records_imported'] == 205
    assert db.rows['import_jobs'][0]['status'] == 'complete'


def test_meta_late_page_failure_is_safe_and_preserves_other_account_result(db, monkeypatch):
    client, _ = meta_client(monkeypatch, [{'data': [meta_row()], 'paging': {'next': 'next', 'cursors': {'after': '2'}}}, RuntimeError('https://provider.invalid?access_token=fixture-secret')])
    monkeypatch.setattr(pipeline, '_get_meta_ads_client', lambda: lambda: client)
    monkeypatch.setattr(pipeline, '_get_google_ads_tools', lambda: (AsyncMock(return_value=report()), lambda value: value))
    for connection in db.rows['ad_account_connections']: connection['account_id'] = ACCOUNT
    accept()
    records = asyncio.run(pipeline.MCPMarketingSync(JOB).sync_property(PROPERTY, date_range='LAST_7_DAYS'))
    assert len(records) == 1 and records[0]['channel_id'] == 'google_ads'
    saved = db.rows['import_jobs'][0]
    assert saved['status'] == 'partial' and saved['records_imported'] == 1
    assert 'fixture-secret' not in saved['error_message']
    assert 'last_imported_at' not in db.rows['ad_account_connections'][1]


def test_fractional_conversions_are_preserved_with_account_identity(db, monkeypatch):
    monkeypatch.setattr(pipeline, '_get_google_ads_tools', lambda: (AsyncMock(return_value=report([row(conversions='0.5')])), lambda value: value))
    db.rows['ad_account_connections'][0]['account_id'] = ACCOUNT
    accept()
    asyncio.run(pipeline.MCPMarketingSync(JOB).sync_property(PROPERTY, ['google_ads'], 'LAST_7_DAYS'))
    assert db.rows['import_jobs'][0]['status'] == 'complete'
    saved = db.rows['fact_marketing_performance'][0]
    assert saved['conversions'] == 0.5
    assert saved['source_account_id'] == ACCOUNT and saved['currency_code'] == 'USD'


def test_first_incremental_import_is_bounded(db):
    assert pipeline.MCPMarketingSync()._calculate_date_range(None) == 'LAST_30_DAYS'


@pytest.mark.parametrize('fail_last', [False, True])
def test_large_daily_report_confirms_batches_and_retains_partial_storage(db, monkeypatch, fail_last):
    from test_marketing_import import MemoryQuery
    original = MemoryQuery.execute
    writes = []
    def execute(query):
        if query.table == 'fact_marketing_performance' and query.operation == 'upsert':
            writes.append(len(query.values))
            if fail_last and len(writes) == 3:
                raise RuntimeError('Final storage batch unavailable')
        return original(query)
    monkeypatch.setattr(MemoryQuery, 'execute', execute)
    provider_report = report([row(campaign=str(1000 + i)) for i in range(700)])
    monkeypatch.setattr(pipeline, '_get_google_ads_tools', lambda: (AsyncMock(return_value=provider_report), lambda value: value))
    db.rows['ad_account_connections'][0]['account_id'] = ACCOUNT
    accept()
    rows = asyncio.run(pipeline.MCPMarketingSync(JOB).sync_property(PROPERTY, ['google_ads'], 'LAST_7_DAYS'))
    assert writes == [250, 250, 200]
    assert len(rows) == (500 if fail_last else 700)
    job = db.rows['import_jobs'][0]
    assert job['records_imported'] == len(rows)
    assert job['status'] == ('partial' if fail_last else 'complete')
    assert ('last_imported_at' in db.rows['ad_account_connections'][0]) is not fail_last


def test_meta_fractional_conversion_actions_are_preserved():
    result = report_records(report([row(actions=[{'action_type': 'lead', 'value': '0.125'}, {'action_type': 'purchase', 'value': '0.25'}])]), PROPERTY, 'meta_ads', ACCOUNT)
    assert result[0]['conversions'] == 0.375
    assert result[0]['source_account_id'] == ACCOUNT


def test_legacy_google_and_meta_normalizers_preserve_identity_and_fractions():
    from utils.google_normalization import normalize_google_data
    from utils.normalization import normalize_meta_data, normalize_ga4_data
    google_frame = normalize_google_data([{'date': '2026-09-10', 'campaign.id': '100', 'campaign.name': 'Fixture', 'source_account_id': ACCOUNT, 'currency_code': 'USD', 'metrics.impressions': 100, 'metrics.clicks': 10, 'metrics.cost_micros': 12345000, 'metrics.conversions': 0.125}])
    assert google_frame.iloc[0]['conversions'] == 0.125
    assert google_frame.iloc[0]['source_account_id'] == ACCOUNT
    meta_frame = normalize_meta_data([{'date_start': '2026-09-10', 'campaign_id': '100', 'campaign_name': 'Fixture', 'account_id': ACCOUNT, 'account_currency': 'USD', 'impressions': '100', 'clicks': '10', 'spend': '12.34', 'actions': [{'action_type': 'lead', 'value': '0.5'}]}])
    assert meta_frame.iloc[0]['conversions'] == 0.5 and meta_frame.iloc[0]['channel_id'] == 'meta_ads'
    ga4_frame = normalize_ga4_data([{'date': '20260910', 'campaign': 'Fixture', 'source': 'search', 'medium': 'organic', 'sessions': 100, 'users': 10, 'conversions': 0.125}])
    assert ga4_frame.iloc[0]['conversions'] == 0.125


def test_legacy_overlap_has_an_actionable_import_status(db, monkeypatch):
    from postgrest.exceptions import APIError
    from test_marketing_import import MemoryQuery
    original = MemoryQuery.execute
    def execute(query):
        if query.table == 'fact_marketing_performance' and query.operation == 'upsert':
            raise APIError({'code': '23514', 'message': 'Historical campaign rows need account reconciliation before importing these dates.', 'details': None, 'hint': None})
        return original(query)
    monkeypatch.setattr(MemoryQuery, 'execute', execute)
    monkeypatch.setattr(pipeline, '_get_google_ads_tools', lambda: (AsyncMock(return_value=report()), lambda value: value))
    db.rows['ad_account_connections'][0]['account_id'] = ACCOUNT
    accept()
    asyncio.run(pipeline.MCPMarketingSync(JOB).sync_property(PROPERTY, ['google_ads'], 'LAST_7_DAYS'))
    assert db.rows['import_jobs'][0]['status'] == 'failed'
    assert 'Historical campaign rows need account reconciliation' in db.rows['import_jobs'][0]['error_message']
