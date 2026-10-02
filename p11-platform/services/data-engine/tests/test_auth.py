"""Service authentication must fail closed, including when configuration is missing."""
import pytest
from fastapi import HTTPException

import utils.auth as auth


@pytest.mark.parametrize('provided', [None, '', 'anything'])
def test_unconfigured_api_key_never_allows_requests(monkeypatch, provided):
    monkeypatch.setattr(auth, 'DATA_ENGINE_API_KEY', None)
    with pytest.raises(HTTPException) as exc:
        auth.verify_api_key(provided)
    assert exc.value.status_code == 503


@pytest.mark.parametrize('provided', [None, '', 'Bearer anything'])
def test_unconfigured_bearer_key_never_allows_requests(monkeypatch, provided):
    monkeypatch.delenv('DATA_ENGINE_API_KEY', raising=False)
    with pytest.raises(HTTPException) as exc:
        auth.verify_service_key(provided)
    assert exc.value.status_code == 503


@pytest.mark.parametrize('provided', [None, '', 'Basic secret', 'Bearer wrong', 'Bearer secret extra'])
def test_bearer_requires_the_exact_key(monkeypatch, provided):
    monkeypatch.setenv('DATA_ENGINE_API_KEY', 'secret')
    with pytest.raises(HTTPException) as exc:
        auth.verify_service_key(provided)
    assert exc.value.status_code == 401


def test_matching_keys_are_accepted(monkeypatch):
    monkeypatch.setenv('DATA_ENGINE_API_KEY', 'test-secret')
    monkeypatch.setattr(auth, 'DATA_ENGINE_API_KEY', 'test-secret')
    auth.verify_service_key('Bearer test-secret')
    assert auth.verify_api_key('test-secret') == 'test-secret'


def test_non_ascii_invalid_keys_are_rejected_without_server_error(monkeypatch):
    monkeypatch.setenv('DATA_ENGINE_API_KEY', 'secret')
    monkeypatch.setattr(auth, 'DATA_ENGINE_API_KEY', 'secret')
    with pytest.raises(HTTPException) as exc:
        auth.verify_service_key('Bearer é')
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        auth.verify_api_key('é')
    assert exc.value.status_code == 403
