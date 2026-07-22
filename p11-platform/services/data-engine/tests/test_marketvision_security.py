"""
Security regression tests for MarketVision data-engine routers.

Covers:
- API-key auth on scraper, brand-intelligence, and competitor-intake routers
- Competitor/property membership re-validation inside the service boundary
"""

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import utils.auth as auth_module
from routers.brand_intelligence import router as brand_router
from routers.brand_intelligence import verify_competitors_in_property
from routers.competitor_intake import router as intake_router
from routers.scraper import router as scraper_router
from routers.scraper import verify_competitor_in_property


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(auth_module, "DATA_ENGINE_API_KEY", "test-secret-key")
    app = FastAPI()
    app.include_router(scraper_router)
    app.include_router(brand_router)
    app.include_router(intake_router)
    return TestClient(app)


PROTECTED_POST_ENDPOINTS = [
    ("/scraper/discover", {"property_id": "p1"}),
    ("/scraper/refresh-pricing", {"property_id": "p1"}),
    ("/scraper/website/batch", {"property_id": "p1"}),
    ("/scraper/website/refresh", {"property_id": "p1", "competitor_id": "c1"}),
    ("/scraper/apartments-com/batch", {"property_id": "p1"}),
    ("/scraper/apartments-com/refresh", {"property_id": "p1", "competitor_id": "c1"}),
    ("/scraper/brand-intelligence", {"property_id": "p1"}),
    ("/scraper/brand-intelligence/batch", {"property_id": "p1", "competitor_ids": ["c1"]}),
    ("/scraper/brand-intelligence/search", {"query": "pool", "property_id": "p1"}),
    ("/competitor-intake/enrich", {"batch_id": "b1", "property_id": "p1"}),
]

PROTECTED_GET_ENDPOINTS = [
    "/scraper/status",
    "/scraper/brand-intelligence/property/p1",
    "/scraper/brand-intelligence/competitor/c1?property_id=p1",
    "/scraper/brand-intelligence/job/j1",
]


@pytest.mark.parametrize("path,body", PROTECTED_POST_ENDPOINTS)
def test_post_endpoints_require_api_key(client, path, body):
    response = client.post(path, json=body)
    assert response.status_code == 401


@pytest.mark.parametrize("path,body", PROTECTED_POST_ENDPOINTS)
def test_post_endpoints_reject_wrong_api_key(client, path, body):
    response = client.post(path, json=body, headers={"X-API-Key": "wrong-key"})
    assert response.status_code == 403


@pytest.mark.parametrize("path", PROTECTED_GET_ENDPOINTS)
def test_get_endpoints_require_api_key(client, path):
    response = client.get(path)
    assert response.status_code == 401


def test_scraper_status_allows_valid_key(client):
    response = client.get("/scraper/status", headers={"X-API-Key": "test-secret-key"})
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def in_(self, *_args, **_kwargs):
        return self

    def execute(self):
        class _Result:
            def __init__(self, data):
                self.data = data

        return _Result(self._rows)


class _FakeSupabase:
    def __init__(self, rows):
        self._rows = rows

    def table(self, _name):
        return _FakeQuery(self._rows)


class TestCompetitorMembership:
    def test_verify_competitor_in_property_returns_row(self):
        rows = [{"id": "c1", "name": "Comp", "property_id": "p1", "website_url": None, "ils_listings": {}}]
        row = verify_competitor_in_property(_FakeSupabase(rows), "c1", "p1")
        assert row["id"] == "c1"

    def test_verify_competitor_in_property_rejects_cross_property(self):
        with pytest.raises(HTTPException) as exc_info:
            verify_competitor_in_property(_FakeSupabase([]), "c-other-tenant", "p1")
        assert exc_info.value.status_code == 404

    def test_verify_competitors_in_property_accepts_all_members(self):
        rows = [{"id": "c1"}, {"id": "c2"}]
        verify_competitors_in_property(_FakeSupabase(rows), ["c1", "c2"], "p1")

    def test_verify_competitors_in_property_rejects_missing(self):
        rows = [{"id": "c1"}]
        with pytest.raises(HTTPException) as exc_info:
            verify_competitors_in_property(_FakeSupabase(rows), ["c1", "c-foreign"], "p1")
        assert exc_info.value.status_code == 404
        assert "c-foreign" in exc_info.value.detail

    def test_verify_competitors_in_property_allows_empty_list(self):
        verify_competitors_in_property(_FakeSupabase([]), [], "p1")
