"""Confirmed import outcomes. Job completion is not proof of report completeness."""
from dataclasses import dataclass, asdict
from typing import Literal


@dataclass(frozen=True)
class PipelineOutcome:
    status: Literal['success', 'error', 'skipped']
    coverage: Literal['complete_with_data', 'complete_empty', 'incomplete', 'failed', 'not_requested']
    records: int = 0
    error: str | None = None

    def __post_init__(self):
        if self.records < 0 or (self.status == 'success' and self.coverage not in {'complete_with_data', 'complete_empty'}):
            raise ValueError('Import outcome is inconsistent')
        if self.coverage == 'complete_empty' and self.records:
            raise ValueError('An empty report cannot contain records')

    def result(self, pipeline: str) -> dict:
        return {'pipeline': pipeline, **asdict(self)}


def load_confirmed(supabase, records: list[dict], property_id: str) -> PipelineOutcome:
    if not property_id or any(row.get('property_id') != property_id for row in records):
        raise ValueError('Every imported record must belong to the selected community')
    if not records:
        return PipelineOutcome('success', 'complete_empty')
    response = supabase.table('fact_marketing_performance').upsert(
        records, on_conflict='date,property_id,channel_id,source_account_id,campaign_id'
    ).execute()
    if not isinstance(response.data, list) or len(response.data) != len(records):
        return PipelineOutcome('error', 'incomplete', error='The database did not confirm every imported row')
    expected = {(row['date'], row['property_id'], row['channel_id'], row['source_account_id'], row['campaign_id']) for row in records}
    actual = {(row.get('date'), row.get('property_id'), row.get('channel_id'), row.get('source_account_id'), row.get('campaign_id')) for row in response.data}
    if actual != expected:
        return PipelineOutcome('error', 'incomplete', error='Imported row identities were not confirmed')
    return PipelineOutcome('success', 'complete_with_data', records=len(records))


def combine(outcomes: list[PipelineOutcome]) -> PipelineOutcome:
    if not outcomes:
        return PipelineOutcome('skipped', 'not_requested', error='No linked accounts are configured')
    count = sum(outcome.records for outcome in outcomes)
    if any(outcome.status != 'success' for outcome in outcomes):
        return PipelineOutcome('error', 'incomplete', count, 'One or more account reports are incomplete')
    return PipelineOutcome('success', 'complete_with_data' if count else 'complete_empty', count)
