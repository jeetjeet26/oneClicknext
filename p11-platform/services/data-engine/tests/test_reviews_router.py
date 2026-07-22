"""
Contract tests for the ReviewFlow review-ingestion endpoints.

These assert the canonical review paths exist in the real FastAPI OpenAPI
schema (the Phase 1 gate) and exercise the request/response contract with
mocked provider clients.
"""

import sys
import types
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers.reviews import router as reviews_router  # noqa: E402


EXPECTED_PATHS = [
    "/scraper/google-reviews",
    "/scraper/google-reviews/full",
    "/scraper/google-reviews/search",
    "/scraper/yelp-reviews",
    "/scraper/yelp-reviews/from-url",
]


@pytest.fixture()
def app():
    app = FastAPI()
    app.include_router(reviews_router)
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _google_review_dict():
    return {
        "platform_review_id": "google-place123-abcdef1234567890",
        "reviewer_name": "Jane Resident",
        "reviewer_avatar_url": None,
        "rating": 5,
        "review_text": "Great maintenance team, quick fixes.",
        "review_date": datetime(2026, 7, 1).isoformat(),
        "language": "en",
        "relative_time": "2 weeks ago",
        "platform": "google",
    }


def _yelp_review_dict():
    return {
        "platform_review_id": "yelp-review-1",
        "reviewer_name": "John D.",
        "reviewer_avatar_url": None,
        "rating": 2,
        "review_text": "Parking was a nightmare.",
        "review_date": datetime(2026, 6, 15).isoformat(),
        "review_url": "https://yelp.com/biz/x",
        "platform": "yelp",
    }


class FakeGoogleReview:
    def to_dict(self):
        return _google_review_dict()


class FakeYelpReview:
    def to_dict(self):
        return _yelp_review_dict()


def test_review_endpoints_present_in_openapi_schema(app):
    schema = app.openapi()
    for path in EXPECTED_PATHS:
        assert path in schema["paths"], f"Missing canonical review endpoint: {path}"
        assert "post" in schema["paths"][path]


def test_main_app_registers_review_endpoints():
    """The deployed app (main.py) must expose the canonical review paths."""
    main_source = (Path(__file__).resolve().parents[1] / "main.py").read_text()
    assert "from routers.reviews import router as reviews_router" in main_source
    assert "app.include_router(reviews_router)" in main_source


def test_google_reviews_contract(client, monkeypatch):
    monkeypatch.delenv("DATA_ENGINE_API_KEY", raising=False)
    fake_scraper = MagicMock()
    fake_scraper.get_place_reviews.return_value = [FakeGoogleReview()]

    with patch("scrapers.google_places.GooglePlacesScraper", return_value=fake_scraper):
        response = client.post(
            "/scraper/google-reviews",
            json={"place_id": "place123", "max_reviews": 25},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["retrieval_method"] == "provider_api"
    assert payload["completeness"] == "sample"
    assert len(payload["reviews"]) == 1
    review = payload["reviews"][0]
    assert review["platform_review_id"] == "google-place123-abcdef1234567890"
    assert review["rating"] == 5
    fake_scraper.get_place_reviews.assert_called_once_with("place123", max_reviews=25)


def test_google_reviews_requires_key_when_configured(client, monkeypatch):
    monkeypatch.setenv("DATA_ENGINE_API_KEY", "secret-key")

    response = client.post("/scraper/google-reviews", json={"place_id": "p"})
    assert response.status_code == 401

    response = client.post(
        "/scraper/google-reviews",
        json={"place_id": "p"},
        headers={"Authorization": "Bearer wrong"},
    )
    assert response.status_code == 401

    fake_scraper = MagicMock()
    fake_scraper.get_place_reviews.return_value = []
    with patch("scrapers.google_places.GooglePlacesScraper", return_value=fake_scraper):
        response = client.post(
            "/scraper/google-reviews",
            json={"place_id": "p"},
            headers={"Authorization": "Bearer secret-key"},
        )
    assert response.status_code == 200


def test_google_reviews_provider_error_is_typed(client, monkeypatch):
    monkeypatch.delenv("DATA_ENGINE_API_KEY", raising=False)
    fake_scraper = MagicMock()
    fake_scraper.get_place_reviews.side_effect = RuntimeError("quota exceeded")

    with patch("scrapers.google_places.GooglePlacesScraper", return_value=fake_scraper):
        response = client.post("/scraper/google-reviews", json={"place_id": "p"})

    assert response.status_code == 502
    assert "quota exceeded" in response.json()["detail"]


def test_google_reviews_missing_api_key_is_503(client, monkeypatch):
    monkeypatch.delenv("DATA_ENGINE_API_KEY", raising=False)
    with patch(
        "scrapers.google_places.GooglePlacesScraper",
        side_effect=ValueError("Google Maps API key required"),
    ):
        response = client.post("/scraper/google-reviews", json={"place_id": "p"})
    assert response.status_code == 503


def test_yelp_reviews_contract(client, monkeypatch):
    monkeypatch.delenv("DATA_ENGINE_API_KEY", raising=False)
    fake_client = MagicMock()
    fake_client.get_business_reviews.return_value = [FakeYelpReview()]

    with patch("scrapers.yelp.get_yelp_client", return_value=fake_client):
        response = client.post(
            "/scraper/yelp-reviews",
            json={"business_id": "some-business"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["completeness"] == "sample"
    assert "3 most recent" in payload["note"]
    assert payload["reviews"][0]["platform_review_id"] == "yelp-review-1"


def test_yelp_reviews_unconfigured_is_503(client, monkeypatch):
    monkeypatch.delenv("DATA_ENGINE_API_KEY", raising=False)
    with patch("scrapers.yelp.get_yelp_client", return_value=None):
        response = client.post("/scraper/yelp-reviews", json={"business_id": "b"})
    assert response.status_code == 503


def test_yelp_reviews_from_url_contract(client, monkeypatch):
    monkeypatch.delenv("DATA_ENGINE_API_KEY", raising=False)
    fake_client = MagicMock()
    fake_client.extract_business_id_from_url.return_value = "the-arbors-austin"
    fake_client.get_business_reviews.return_value = [FakeYelpReview()]

    with patch("scrapers.yelp.get_yelp_client", return_value=fake_client):
        response = client.post(
            "/scraper/yelp-reviews/from-url",
            json={"url": "https://www.yelp.com/biz/the-arbors-austin?osq=x"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    fake_client.extract_business_id_from_url.assert_called_once()


def test_yelp_reviews_from_bad_url_reports_failure(client, monkeypatch):
    monkeypatch.delenv("DATA_ENGINE_API_KEY", raising=False)
    fake_client = MagicMock()
    fake_client.extract_business_id_from_url.return_value = None

    with patch("scrapers.yelp.get_yelp_client", return_value=fake_client):
        response = client.post(
            "/scraper/yelp-reviews/from-url",
            json={"url": "https://example.com/not-yelp"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is False
    assert payload["reviews"] == []


def test_google_search_contract(client, monkeypatch):
    monkeypatch.delenv("DATA_ENGINE_API_KEY", raising=False)
    fake_scraper = MagicMock()
    fake_scraper.get_reviews_for_property.return_value = {
        "success": True,
        "place_id": "place123",
        "reviews": [_google_review_dict()],
        "note": "Google Places API returns up to 5 reviews.",
    }

    with patch("scrapers.google_places.GooglePlacesScraper", return_value=fake_scraper):
        response = client.post(
            "/scraper/google-reviews/search",
            json={"property_name": "The Arbors", "address": "123 Main St, Austin TX"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert len(payload["reviews"]) == 1


def test_stable_google_review_ids_are_deterministic():
    from scrapers.google_places import GooglePlacesScraper

    raw = {
        "author_name": "Jane Resident",
        "rating": 4,
        "text": "Lovely pool area",
        "time": 1751000000,
        "language": "en",
    }

    scraper = GooglePlacesScraper.__new__(GooglePlacesScraper)
    first = scraper._parse_review(dict(raw), "placeX")
    second = scraper._parse_review(dict(raw), "placeX")
    assert first is not None and second is not None
    assert first.platform_review_id == second.platform_review_id
    assert first.platform_review_id.startswith("google-placeX-")
