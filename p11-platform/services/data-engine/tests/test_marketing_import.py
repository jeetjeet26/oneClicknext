"""Acceptance, replay safety and persistence outcomes without live providers."""
import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.testclient import TestClient
from routers import marketing_import as api
from pipelines import mcp_marketing_sync as pipeline
from jobs import marketing_import as durable

PROPERTY = '33333333-3333-3333-3333-333333333333'
JOB = '11111111-1111-4111-8111-111111111111'
OTHER = '44444444-4444-4444-4444-444444444444'


class MemoryQuery:
    def __init__(self, database, table):
        self.db, self.table = database, table
        self.operation, self.values, self.filters = 'select', None, []

    def select(self, *args): return self
    def limit(self, *args): return self
    def eq(self, key, value):
        self.filters.append((key, value))
        return self
    def insert(self, values):
        self.operation, self.values = 'insert', values
        return self
    def update(self, values):
        self.operation, self.values = 'update', values
        return self
    def upsert(self, values, **kwargs):
        self.operation, self.values = 'upsert', values
        return self
    def execute(self):
        self.db.events.append((self.table, self.operation, deepcopy(self.values), self.filters[:]))
        if (self.table, self.operation) in self.db.fail:
            raise RuntimeError('Injected database failure')
        rows = self.db.rows.setdefault(self.table, [])
        matched = [row for row in rows if all(row.get(key) == value for key, value in self.filters)]
        if self.operation == 'insert':
            if any(row['id'] == self.values['id'] for row in rows):
                raise RuntimeError('Duplicate primary key')
            if self.db.drop_insert:
                return SimpleNamespace(data=[])
            rows.append(deepcopy(self.values))
            matched = [rows[-1]]
            if self.db.lost_insert_response:
                raise RuntimeError('Lost insert acknowledgement')
        elif self.operation == 'update':
            for row in matched: row.update(deepcopy(self.values))
        elif self.operation == 'upsert':
            rows.extend(deepcopy(self.values))
            matched = self.values
        if (self.table, self.operation) in self.db.empty_response:
            return SimpleNamespace(data=[])
        return SimpleNamespace(data=deepcopy(matched))


class MemoryDatabase:
    def __init__(self):
        self.rows = {'import_jobs': [], 'ad_account_connections': [
            {'id': 'google-account', 'platform': 'google_ads', 'account_id': '123', 'property_id': PROPERTY, 'is_active': True},
            {'id': 'meta-account', 'platform': 'meta_ads', 'account_id': '456', 'property_id': PROPERTY, 'is_active': True},
        ], 'fact_marketing_performance': []}
        self.events, self.fail, self.empty_response = [], set(), set()
        self.drop_insert = self.lost_insert_response = False
    def table(self, name): return MemoryQuery(self, name)


@pytest.fixture
def db(monkeypatch):
    value = MemoryDatabase()
    monkeypatch.setattr(api, 'get_supabase_client', lambda: value)
    monkeypatch.setattr(pipeline, 'get_supabase_client', lambda: value)
    monkeypatch.setattr(durable, 'get_supabase_client', lambda: value)
    return value


def request(**kwargs):
    return api.SyncMarketingRequest(property_id=PROPERTY, job_id=JOB, **kwargs)


def accept(req=None):
    tasks = BackgroundTasks()
    response = asyncio.run(api.sync_marketing_data(req or request(), tasks))
    return response, tasks


def test_accepts_only_a_saved_job_before_dispatch(db):
    response, tasks = accept()
    assert response['job_id'] == JOB and response['status'] == 'accepted'
    assert db.rows['import_jobs'][0]['status'] == 'pending'
    assert len(tasks.tasks) == 1
    assert db.rows['fact_marketing_performance'] == []


def test_no_acknowledgement_or_dispatch_without_a_saved_job(db):
    db.drop_insert = True
    tasks = BackgroundTasks()
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.sync_marketing_data(request(), tasks))
    assert error.value.status_code == 503
    assert tasks.tasks == []


def test_lost_insert_response_recovers_same_queued_id(db):
    db.lost_insert_response = True
    response, tasks = accept()
    assert response['job_id'] == JOB and response['reused'] is True
    assert len(db.rows['import_jobs']) == 1 and len(tasks.tasks) == 1


def test_repeated_request_reuses_id_and_does_not_replay_finished_job(db):
    accept()
    db.rows['import_jobs'][0]['status'] = 'complete'
    response, tasks = accept()
    assert response['reused'] is True and tasks.tasks == []
    assert len(db.rows['import_jobs']) == 1


def test_reused_id_cannot_change_the_property_or_import_contract(db):
    accept()
    for req in [api.SyncMarketingRequest(property_id=OTHER, job_id=JOB), request(date_range='LAST_30_DAYS')]:
        with pytest.raises(HTTPException) as error: accept(req)
        assert error.value.status_code == 409


def test_missing_connections_do_not_create_a_successful_job(db):
    db.rows['ad_account_connections'] = []
    with pytest.raises(HTTPException) as error: accept()
    assert error.value.status_code == 422
    assert db.rows['import_jobs'] == []


def worker_fixture(db, monkeypatch, *, saved=False, interrupt=False):
    accept(request(date_range='LAST_30_DAYS'))
    job = db.rows['import_jobs'][0]
    account = {'connection_id': 'google-account', 'account_id': '123', 'platform': 'google_ads', 'records': [] if saved else None, 'offset': 9 if saved else 0, 'done': False}
    claimed = False
    async def call(client, name, args):
        nonlocal claimed
        if name == 'claim_marketing_import':
            if claimed: return None
            claimed = True; job['status'] = 'running'
            return {'job': deepcopy(job), 'accounts': [account]}
        if name == 'commit_marketing_import_batch':
            job['records_imported'] = 9
            if interrupt: raise asyncio.CancelledError()
            return {'done': True, 'offset': 9}
        if name == 'finish_marketing_import': job['status'] = 'complete'; return 'complete'
        return None
    rpc_mock = AsyncMock(side_effect=call)
    monkeypatch.setattr(durable, 'rpc', rpc_mock)
    provider = AsyncMock(return_value={'state': 'succeeded', 'records': []})
    monkeypatch.setattr(pipeline.MCPMarketingSync, '_sync_google_ads', provider)
    return job, rpc_mock, provider


def test_worker_claim_prevents_duplicate_execution_and_honors_requested_range(db, monkeypatch):
    job, rpc_mock, provider = worker_fixture(db, monkeypatch)
    asyncio.run(api.run_import_job(JOB)); asyncio.run(api.run_import_job(JOB))
    provider.assert_awaited_once_with(PROPERTY, '123', 'LAST_30_DAYS')
    assert job['status'] == 'complete'
    assert sum(call.args[1] == 'save_marketing_import_report' for call in rpc_mock.await_args_list) == 1


def test_worker_does_not_execute_when_claim_fails(db, monkeypatch):
    _, _, provider = worker_fixture(db, monkeypatch)
    monkeypatch.setattr(durable, 'rpc', AsyncMock(return_value=None))
    asyncio.run(api.run_import_job(JOB)); provider.assert_not_awaited()


def test_interrupted_worker_retains_confirmed_count(db, monkeypatch):
    job, _, _ = worker_fixture(db, monkeypatch, interrupt=True)
    with pytest.raises(asyncio.CancelledError): asyncio.run(api.run_import_job(JOB))
    assert job['status'] == 'running' and job['records_imported'] == 9


def test_resumed_worker_uses_saved_report_without_refetching_provider(db, monkeypatch):
    job, rpc_mock, provider = worker_fixture(db, monkeypatch, saved=True)
    asyncio.run(api.run_import_job(JOB))
    provider.assert_not_awaited()
    assert not any(call.args[1] == 'save_marketing_import_report' for call in rpc_mock.await_args_list)
    assert job['status'] == 'complete'


def test_historical_pending_job_is_not_dispatched(db):
    accept(); db.rows['import_jobs'][0]['recovery_version'] = None
    with pytest.raises(HTTPException) as error: accept()
    assert error.value.status_code == 409


def test_specific_connection_must_belong_to_requested_property_and_channel(db):
    with pytest.raises(HTTPException) as error: accept(request(connection_ids=[OTHER]))
    assert error.value.status_code == 422
    assert not db.rows['import_jobs']


def test_automatic_recovery_requires_explicit_enablement(monkeypatch):
    monkeypatch.delenv('MARKETING_IMPORT_WORKER_ENABLED', raising=False)
    assert not durable.worker_enabled()
    monkeypatch.setenv('MARKETING_IMPORT_WORKER_ENABLED', 'true')
    assert durable.worker_enabled()


def configured_sync(db, monkeypatch, google_records=None, meta_state='succeeded'):
    accept()
    sync = pipeline.MCPMarketingSync(JOB)
    google = AsyncMock(return_value=sync._build_channel_result('google_ads', 'succeeded', google_records or []))
    meta = AsyncMock(return_value=sync._build_channel_result('meta_ads', meta_state, [], 'Meta unavailable' if meta_state != 'succeeded' else None))
    monkeypatch.setattr(sync, '_sync_google_ads', google)
    monkeypatch.setattr(sync, '_sync_meta_ads', meta)
    return sync, google, meta


def test_freshness_only_advances_after_confirmed_write_for_exact_account(db, monkeypatch):
    sync, _, _ = configured_sync(db, monkeypatch, [{'campaign_id': 'c1'}])
    asyncio.run(sync.sync_property(PROPERTY, ['google_ads'], 'LAST_7_DAYS'))
    job = db.rows['import_jobs'][0]
    assert job['status'] == 'complete' and job['records_imported'] == 1
    assert 'last_imported_at' in db.rows['ad_account_connections'][0]
    assert 'last_imported_at' not in db.rows['ad_account_connections'][1]
    writes = [(table, operation) for table, operation, _, _ in db.events]
    assert writes.index(('fact_marketing_performance', 'upsert')) < writes.index(('ad_account_connections', 'update'))
    started = [values['started_at'] for table, operation, values, _ in db.events if table == 'import_jobs' and operation == 'update' and 'started_at' in values]
    assert len(set(started)) == 1


@pytest.mark.parametrize('failure', ['exception', 'unconfirmed'])
def test_failed_or_unconfirmed_write_never_advances_freshness(db, monkeypatch, failure):
    sync, _, _ = configured_sync(db, monkeypatch, [{'campaign_id': 'c1'}])
    getattr(db, 'fail' if failure == 'exception' else 'empty_response').add(('fact_marketing_performance', 'upsert'))
    asyncio.run(sync.sync_property(PROPERTY, ['google_ads']))
    assert db.rows['import_jobs'][0]['status'] == 'failed'
    assert db.rows['import_jobs'][0]['records_imported'] == 0
    assert not any(table == 'ad_account_connections' and operation == 'update' for table, operation, _, _ in db.events)


def test_partial_result_retains_records_and_successful_empty_sync_is_valid(db, monkeypatch):
    sync, _, _ = configured_sync(db, monkeypatch, [{'campaign_id': 'c1'}], meta_state='failed')
    asyncio.run(sync.sync_property(PROPERTY))
    assert db.rows['import_jobs'][0]['status'] == 'partial'
    assert db.rows['import_jobs'][0]['records_imported'] == 1
    db.rows['import_jobs'] = []
    sync, _, _ = configured_sync(db, monkeypatch)
    asyncio.run(sync.sync_property(PROPERTY))
    assert db.rows['import_jobs'][0]['status'] == 'complete'
    assert db.rows['import_jobs'][0]['records_imported'] == 0


def test_missing_or_skipped_all_channels_fail_instead_of_succeeding(db, monkeypatch):
    sync, google, _ = configured_sync(db, monkeypatch, meta_state='skipped')
    google.return_value = sync._build_channel_result('google_ads', 'skipped', [], 'Tools unavailable')
    asyncio.run(sync.sync_property(PROPERTY))
    assert db.rows['import_jobs'][0]['status'] == 'failed'
    db.rows['ad_account_connections'] = []
    asyncio.run(sync.sync_property(PROPERTY))
    assert db.rows['import_jobs'][0]['status'] == 'failed'


def test_tracking_failure_stops_before_provider_calls(db, monkeypatch):
    sync, google, meta = configured_sync(db, monkeypatch)
    db.empty_response.add(('import_jobs', 'update'))
    with pytest.raises(RuntimeError): asyncio.run(sync.sync_property(PROPERTY))
    google.assert_not_awaited()
    meta.assert_not_awaited()


@pytest.mark.parametrize('body', [
    {'property_id': 'invalid'}, {'property_id': PROPERTY, 'channels': []},
    {'property_id': PROPERTY, 'channels': ['ga4']}, {'property_id': PROPERTY, 'date_range': 'ALL_TIME'},
    {'property_id': PROPERTY, 'job_id': 'invalid'},
])
def test_http_validation_rejects_unsupported_requests(db, monkeypatch, body):
    monkeypatch.setenv('DATA_ENGINE_API_KEY', 'test-import-key')
    app = FastAPI(); app.include_router(api.router)
    response = TestClient(app).post('/sync-marketing-data', json=body, headers={'Authorization': 'Bearer test-import-key'})
    assert response.status_code == 422
    assert db.events == []


def test_http_authentication_fails_closed(db, monkeypatch):
    monkeypatch.delenv('DATA_ENGINE_API_KEY', raising=False)
    app = FastAPI(); app.include_router(api.router)
    assert TestClient(app).post('/sync-marketing-data', json={'property_id': PROPERTY}).status_code == 503
    monkeypatch.setenv('DATA_ENGINE_API_KEY', 'test-import-key')
    assert TestClient(app).post('/sync-marketing-data', json={'property_id': PROPERTY}).status_code == 401
    assert db.events == []


def test_linked_retry_uses_original_reference_time_for_provider_dates(db, monkeypatch):
    job, _, _ = worker_fixture(db, monkeypatch)
    job['reference_at'] = '2026-08-01T01:30:00+00:00'
    job['created_at'] = '2026-09-23T12:00:00+00:00'
    observed = []
    async def inspect_dates(self, property_id, account_id, date_range):
        observed.append(self.reference_time.isoformat())
        return {'state': 'succeeded', 'records': []}
    monkeypatch.setattr(pipeline.MCPMarketingSync, '_sync_google_ads', inspect_dates)
    asyncio.run(api.run_import_job(JOB))
    assert observed == ['2026-08-01T01:30:00+00:00']
