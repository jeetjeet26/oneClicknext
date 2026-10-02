from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from jobs.propertyaudit import PropertyAuditExecutor, RunStateConflict, recover_stale_running_runs

NOW = datetime(2026, 9, 15, 12, tzinfo=timezone.utc)


def row(identifier="run-1", **values):
    return dict(id=identifier, status="running", surface="openai", started_at=(NOW - timedelta(hours=1)).isoformat(),
                last_updated_at=(NOW - timedelta(minutes=20)).isoformat(), current_query_index=2, query_count=10, execution_version=1, **values)


class Store:
    def __init__(self, rows, before_write=None, acknowledge=True):
        self.rows = {r["id"]: deepcopy(r) for r in rows}
        self.before_write = before_write
        self.acknowledge = acknowledge
        self.writes = []
        self.reads = 0

    def table(self, table):
        assert table == "geo_runs"
        store = self

        class Query:
            def __init__(self):
                self.filters = []
                self.change = None
                self.cap = 1000

            def select(self, _columns): return self
            def order(self, _column): return self
            def limit(self, count): self.cap = count; return self
            def eq(self, key, value): self.filters.append(lambda r: r.get(key) == value); return self
            def is_(self, key, value):
                assert value == "null"
                self.filters.append(lambda r: r.get(key) is None)
                return self
            def gt(self, key, value): self.filters.append(lambda r: r[key] > value); return self
            def update(self, values): self.change = values; return self
            def execute(self):
                if self.change is not None and store.before_write:
                    callback, store.before_write = store.before_write, None
                    callback(store)
                matches = [r for _, r in sorted(store.rows.items()) if all(test(r) for test in self.filters)][:self.cap]
                if self.change is not None:
                    store.writes.append((deepcopy(self.change), [r["id"] for r in matches]))
                    for item in matches: item.update(self.change)
                    return SimpleNamespace(data=deepcopy(matches) if store.acknowledge else [])
                store.reads += 1
                return SimpleNamespace(data=deepcopy(matches))
        return Query()


def test_recovery_does_not_fail_a_worker_that_heartbeats_after_the_read():
    store = Store([row()], before_write=lambda db: db.rows["run-1"].update(last_updated_at=NOW.isoformat()))
    assert recover_stale_running_runs(store, now=NOW) == 0
    assert store.rows["run-1"]["status"] == "running"


def test_recovery_preserves_a_competing_completed_run():
    store = Store([row()], before_write=lambda db: db.rows["run-1"].update(status="completed"))
    assert recover_stale_running_runs(store, now=NOW) == 0
    assert store.rows["run-1"]["status"] == "completed"


def test_recovery_counts_only_confirmed_transitions():
    store = Store([row()], acknowledge=False)
    assert recover_stale_running_runs(store, now=NOW) == 0
    assert store.rows["run-1"]["status"] == "failed"


def test_recovery_pages_beyond_default_api_limit_without_skipping_removed_rows():
    store = Store([row(f"run-{i:04}") for i in range(1005)])
    assert recover_stale_running_runs(store, now=NOW) == 1005
    assert store.reads == 3
    assert all(r["status"] == "failed" for r in store.rows.values())


def test_missing_heartbeat_uses_creation_and_requires_heartbeat_still_missing():
    stale = row(); stale["last_updated_at"] = None
    store = Store([stale])
    assert recover_stale_running_runs(store, now=NOW) == 1
    store = Store([stale], before_write=lambda db: db.rows["run-1"].update(last_updated_at=NOW.isoformat()))
    assert recover_stale_running_runs(store, now=NOW) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["running", "completed", "failed"])
async def test_unclaimed_worker_cannot_change_a_run(status):
    executor = PropertyAuditExecutor(Mock())
    executor.claim_queued_run = Mock(return_value=None)
    executor._get_run = Mock(return_value={"status": status})
    executor._update_run_status = Mock()
    result = await executor.execute_run("run-1")
    assert result["success"] is False
    assert result["state_saved"] is False
    executor._update_run_status.assert_not_called()


def test_worker_completion_and_progress_do_not_overwrite_a_terminal_state():
    completed = row(); completed["status"] = "completed"
    store = Store([completed])
    executor = PropertyAuditExecutor(store)
    with pytest.raises(RunStateConflict): executor._update_run_status("run-1", "failed")
    with pytest.raises(RunStateConflict): executor._update_progress("run-1", 50, 5)
    assert store.rows["run-1"] == completed


def test_worker_requires_confirmation_of_a_status_write():
    executor = PropertyAuditExecutor(Store([row()], acknowledge=False))
    with pytest.raises(RunStateConflict): executor._update_run_status("run-1", "completed")


@pytest.mark.asyncio
async def test_no_provider_answers_is_reported_as_failure():
    executor = PropertyAuditExecutor(Mock())
    executor._get_queries = Mock(return_value=[{"id": "query-1", "text": "Fixture question"}])
    executor._get_property_context = Mock(return_value={"name": "Fixture"})
    executor._get_property_config = Mock(return_value={})
    executor._update_progress = Mock()
    executor._process_query = AsyncMock(side_effect=RuntimeError("Provider response could not be parsed"))
    executor._calculate_aggregate_scores = Mock(return_value={"overall_score": 0, "visibility_pct": 0})
    executor._insert_scores = Mock()
    executor._update_run_status = Mock()
    executor._refresh_siteaudit_analyst_if_batch_ready = AsyncMock()
    result = await executor.execute_run("run-1", claimed_run={"property_id": "property-1", "surface": "openai"})
    assert result["success"] is False
    assert result["processed"] == 0
    assert result["errors"] == 1
    assert executor._update_run_status.call_args.args[1] == "failed"
