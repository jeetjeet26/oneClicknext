from types import SimpleNamespace
from unittest.mock import Mock
import pytest
import run_pipelines
from pipelines import google_ads, meta_ads, ga4
from pipelines.outcome import PipelineOutcome, load_confirmed, combine


@pytest.mark.parametrize('name,module', [('meta_ads', meta_ads), ('google_ads', google_ads), ('ga4', ga4)])
def test_runner_never_treats_missing_outcome_as_success(monkeypatch, name, module):
    monkeypatch.setattr(module, 'run_pipeline', lambda: None)
    result = run_pipelines.run_confirmed_pipeline(name)
    assert result['status'] == 'error' and result['coverage'] == 'failed'


def test_runner_preserves_skipped_and_actual_count(monkeypatch):
    monkeypatch.setattr(meta_ads, 'run_pipeline', lambda: PipelineOutcome('skipped', 'not_requested'))
    assert run_pipelines.run_meta_pipeline()['status'] == 'skipped'
    monkeypatch.setattr(meta_ads, 'run_pipeline', lambda: PipelineOutcome('success', 'complete_with_data', 7))
    assert run_pipelines.run_meta_pipeline()['records'] == 7


def test_account_lookup_failure_never_fetches_environment_account(monkeypatch):
    for key in ('GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET'):
        monkeypatch.setenv(key, 'fixture')
    db = Mock(); db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.side_effect = RuntimeError('Unavailable')
    monkeypatch.setattr(google_ads, 'get_supabase', lambda: db)
    fetch = Mock(); monkeypatch.setattr(google_ads, 'fetch_google_data', fetch)
    with pytest.raises(RuntimeError):
        google_ads.run_pipeline()
    fetch.assert_not_called()


def test_load_requires_community_and_database_acknowledgement():
    record = dict(property_id='a', date='2026-10-12', channel_id='meta_ads', source_account_id='123', campaign_id='456')
    db = Mock(); db.table.return_value.upsert.return_value.execute.return_value = SimpleNamespace(data=[])
    assert load_confirmed(db, [record], 'a').coverage == 'incomplete'
    with pytest.raises(ValueError):
        load_confirmed(db, [record], 'b')
    db.table.return_value.upsert.return_value.execute.return_value = SimpleNamespace(data=[record])
    assert load_confirmed(db, [record], 'a').records == 1


def test_partial_account_report_does_not_look_complete():
    outcome = combine([PipelineOutcome('success', 'complete_with_data', 3), PipelineOutcome('error', 'failed')])
    assert outcome.status == 'error' and outcome.coverage == 'incomplete' and outcome.records == 3
    assert combine([PipelineOutcome('success', 'complete_empty')]).coverage == 'complete_empty'


@pytest.mark.parametrize('module', [meta_ads, ga4])
def test_missing_community_is_rejected_before_provider_fetch(monkeypatch, module):
    for key in ('META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'GA4_PROPERTY_ID', 'GA4_CREDENTIALS_JSON'):
        monkeypatch.setenv(key, 'fixture')
    monkeypatch.delenv('TARGET_PROPERTY_ID', raising=False)
    with pytest.raises(ValueError, match='community'):
        module.run_pipeline()
