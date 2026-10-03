from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
from jobs import google_calendar_health_monitor as job


class Database:
    def __init__(self):
        self.calls = []
        self.fail_save_once = False
        self.save_count = 0
        self.claim_state = "claimed"
        self.finish_state = "saved"

    def rpc(self, name, payload):
        self.calls.append((name, payload))
        def execute():
            if name == "claim_calendar_token_refresh":
                return SimpleNamespace(data={"state": self.claim_state, "refreshToken": "private-refresh", "permissionState":"confirmed", "accessToken":"saved-token", "version":2,"expiresAt":(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()})
            self.save_count += 1
            if self.fail_save_once and self.save_count == 1:
                raise RuntimeError("Lost response")
            if payload["p_outcome"] != "success":
                return SimpleNamespace(data={"state": {"unconfirmed": "review", "temporary_failure": "failed"}.get(payload["p_outcome"], payload["p_outcome"])})
            return SimpleNamespace(data={"state": self.finish_state, "permissionState":"confirmed", "accessToken": "saved-token", "refreshToken": "rotated-token", "version": 2, "expiresAt": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()})
        return SimpleNamespace(execute=execute)


@pytest.fixture
def setup(monkeypatch):
    for prefix in ["GOOGLE", "MICROSOFT"]:
        monkeypatch.setenv(prefix + "_CLIENT_ID", "fixture")
        monkeypatch.setenv(prefix + "_CLIENT_SECRET", "fixture")
    c = {"id": "calendar", "property_id": "property", "credential_version": 1, "provider": "microsoft", "account_email": "fixture@example.invalid", "calendar_id": "primary", "sync_enabled": True, "token_status": "healthy", "token_expires_at": "2020-01-01T00:00:00Z"}
    http = SimpleNamespace(post=AsyncMock(return_value=httpx.Response(200, json={"access_token": "new-token", "refresh_token": "rotated-token", "expires_in": 3600})))
    return c, Database(), http


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["google", "microsoft"])
async def test_both_providers_use_atomic_rotation(setup, provider):
    c, db, http = setup
    c["provider"] = provider
    assert await job.refresh_token_if_needed(c, db, http) == {"status": "refreshed"}
    assert db.calls[-1][1]["p_tokens"]["refreshToken"] == "rotated-token"
    assert http.post.call_args.kwargs["timeout"] == 20
    assert http.post.call_args.kwargs["data"]["refresh_token"] == "private-refresh"
    assert ("microsoftonline" in http.post.call_args.args[0]) == (provider == "microsoft")


@pytest.mark.asyncio
async def test_only_database_save_is_retried(setup):
    c, db, http = setup
    db.fail_save_once = True
    assert await job.refresh_token_if_needed(c, db, http) == {"status": "refreshed"}
    assert http.post.call_count == 1
    assert db.calls[-1] == db.calls[-2]


@pytest.mark.asyncio
async def test_timeout_requires_reconnect_without_exposing_details(setup):
    c, db, http = setup
    http.post.side_effect = httpx.ReadTimeout("SECRET NETWORK DETAILS")
    assert await job.refresh_token_if_needed(c, db, http) == {"status": "review"}
    assert db.calls[-1][1]["p_outcome"] == "unconfirmed"
    assert "SECRET NETWORK DETAILS" not in repr(db.calls)


@pytest.mark.asyncio
async def test_stale_save_is_never_healthy(setup):
    c, db, http = setup
    db.finish_state = "connection_changed"
    assert await job.refresh_token_if_needed(c, db, http) == {"status": "connection_changed"}


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["busy", "refresh_unconfirmed", "connection_changed", "retry_later", "permissions_incomplete", "permissions_unconfirmed"])
async def test_claim_holds_do_not_call_provider(setup, state):
    c, db, http = setup
    db.claim_state = state
    assert (await job.refresh_token_if_needed(c, db, http))["status"] == state
    http.post.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [{"access_token": "x", "expires_in": 0}, {"access_token": "x", "expires_in": True}, {"access_token": "x", "expires_in": 3600, "refresh_token": None}, {}])
async def test_malformed_success_is_unconfirmed(setup, payload):
    c, db, http = setup
    http.post.return_value = httpx.Response(200, json=payload)
    assert await job.refresh_token_if_needed(c, db, http) == {"status": "review"}


@pytest.mark.asyncio
async def test_not_due_is_not_a_new_health_confirmation(setup):
    c, db, http = setup
    c["token_expires_at"] = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    db.claim_state = "ready"
    assert await job.refresh_token_if_needed(c, db, http) == {"status": "not_due"}
    assert len(db.calls) == 1
    assert db.calls[0][1]["p_force"] is False
    http.post.assert_not_called()


@pytest.mark.asyncio
async def test_monitor_has_no_unfenced_calendar_updates(monkeypatch):
    q = SimpleNamespace()
    q.select = lambda _: q
    q.eq = lambda *_: q
    q.execute = lambda: SimpleNamespace(data=[{"id": "one"}, {"id": "two"}])
    db = SimpleNamespace(table=lambda _: q)
    monkeypatch.setattr(job, "refresh_token_if_needed", AsyncMock(side_effect=[{"status": "refreshed"}, {"status": "connection_changed"}]))
    assert await job.monitor_all_calendars(db) == {"refreshed": 1, "not_due": 0, "busy": 0, "reconnect_required": 0, "errors": 1}

@pytest.mark.asyncio
@pytest.mark.parametrize("scope", ["User.Read", None, 10])
async def test_scope_evidence_reaches_atomic_save(setup, scope):
    c, db, http = setup
    http.post.return_value = httpx.Response(200, json={"access_token":"new", "expires_in":3600, "scope":scope})
    db.finish_state = "permissions_incomplete"
    assert await job.refresh_token_if_needed(c, db, http) == {"status":"permissions_incomplete"}
    assert db.calls[-1][1]["p_tokens"]["scope"] == (scope if isinstance(scope,str) else None)

@pytest.mark.asyncio
async def test_fresh_unconfirmed_grant_is_not_not_due(setup):
    c, db, http = setup
    c["token_expires_at"] = (datetime.now(timezone.utc)+timedelta(days=2)).isoformat()
    db.claim_state = "permissions_unconfirmed"
    assert await job.refresh_token_if_needed(c, db, http) == {"status":"permissions_unconfirmed"}
    http.post.assert_not_called()
