"""
ReviewFlow review-ingestion endpoints.

Typed contracts mirrored by zod schemas in
p11-platform/apps/web/utils/reviewflow/ingestion.ts. Every response reports:
- success + optional error
- reviews[] with stable platform review IDs
- retrieval_method ('provider_api' | 'scraper')
- completeness ('complete' | 'sample' | 'degraded' | 'unknown')
- note describing sampling limits / degradations

Authentication: when DATA_ENGINE_API_KEY is set the endpoints require a
matching Bearer token; when unset (local development) requests are allowed.
"""

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scraper", tags=["reviews"])


def verify_service_key(authorization: Optional[str]) -> None:
    """Require Bearer DATA_ENGINE_API_KEY when the key is configured."""
    expected_key = os.environ.get("DATA_ENGINE_API_KEY")
    if not expected_key:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization")
    token = authorization.replace("Bearer ", "", 1)
    if token != expected_key:
        raise HTTPException(status_code=401, detail="Invalid API key")


# ---------------------------------------------------------------------------
# Contract models
# ---------------------------------------------------------------------------

class ObservedReview(BaseModel):
    platform_review_id: Optional[str] = None
    reviewer_name: Optional[str] = None
    reviewer_avatar_url: Optional[str] = None
    rating: Optional[float] = None
    review_text: Optional[str] = None
    review_date: Optional[str] = None


class ReviewsResponse(BaseModel):
    success: bool
    error: Optional[str] = None
    reviews: List[ObservedReview] = Field(default_factory=list)
    retrieval_method: Optional[str] = None
    completeness: Optional[str] = None
    note: Optional[str] = None


class GoogleReviewsRequest(BaseModel):
    place_id: str
    max_reviews: int = Field(default=50, ge=1, le=200)


class GoogleReviewsSearchRequest(BaseModel):
    property_name: str
    address: str
    lat: Optional[float] = None
    lng: Optional[float] = None


class YelpReviewsRequest(BaseModel):
    business_id: str


class YelpReviewsFromUrlRequest(BaseModel):
    url: str


def _to_observed(raw: Dict[str, Any]) -> ObservedReview:
    return ObservedReview(
        platform_review_id=raw.get("platform_review_id"),
        reviewer_name=raw.get("reviewer_name"),
        reviewer_avatar_url=raw.get("reviewer_avatar_url"),
        rating=raw.get("rating"),
        review_text=raw.get("review_text"),
        review_date=raw.get("review_date"),
    )


# ---------------------------------------------------------------------------
# Google
# ---------------------------------------------------------------------------

@router.post("/google-reviews", response_model=ReviewsResponse)
async def google_reviews(
    request: GoogleReviewsRequest,
    authorization: Optional[str] = Header(None),
) -> ReviewsResponse:
    """Fetch reviews via the Google Places API (max ~5 reviews per place)."""
    verify_service_key(authorization)

    try:
        from scrapers.google_places import GooglePlacesScraper
        scraper = GooglePlacesScraper()
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error))

    try:
        reviews = scraper.get_place_reviews(request.place_id, max_reviews=request.max_reviews)
    except Exception as error:
        logger.exception("Google Places review fetch failed for %s", request.place_id)
        raise HTTPException(status_code=502, detail=f"Google Places request failed: {error}")

    return ReviewsResponse(
        success=True,
        reviews=[_to_observed(review.to_dict()) for review in reviews],
        retrieval_method="provider_api",
        completeness="sample",
        note="Google Places API returns at most 5 reviews per place.",
    )


@router.post("/google-reviews/full", response_model=ReviewsResponse)
async def google_reviews_full(
    request: GoogleReviewsRequest,
    authorization: Optional[str] = Header(None),
) -> ReviewsResponse:
    """
    Fetch all visible reviews by scrolling Google Maps with Playwright.
    Falls back to the Places API (degraded) when Playwright is unavailable.
    """
    verify_service_key(authorization)

    from scrapers.google_places import PLAYWRIGHT_AVAILABLE

    if PLAYWRIGHT_AVAILABLE:
        try:
            from scrapers.google_places import GoogleMapsReviewScraper
            scraper = GoogleMapsReviewScraper(headless=True)
            result = await scraper.scrape_reviews_async(request.place_id, request.max_reviews)
        except Exception as error:
            logger.exception("Google Maps scrape failed for %s", request.place_id)
            result = {"success": False, "reviews": [], "error": str(error)}

        if result.get("success") and result.get("reviews"):
            return ReviewsResponse(
                success=True,
                reviews=[_to_observed(raw) for raw in result.get("reviews", [])],
                retrieval_method="scraper",
                completeness="degraded",
                note=(
                    "Scraped via Google Maps web interface; review dates are approximate "
                    "(relative timestamps) and coverage depends on page rendering."
                ),
            )
        logger.warning(
            "Google Maps scrape returned no reviews for %s; falling back to Places API",
            request.place_id,
        )

    # API fallback (Playwright unavailable or scrape failed/empty).
    try:
        from scrapers.google_places import GooglePlacesScraper
        scraper = GooglePlacesScraper()
        reviews = scraper.get_place_reviews(request.place_id, max_reviews=request.max_reviews)
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error))
    except Exception as error:
        logger.exception("Google Places fallback failed for %s", request.place_id)
        raise HTTPException(status_code=502, detail=f"Google review retrieval failed: {error}")

    return ReviewsResponse(
        success=True,
        reviews=[_to_observed(review.to_dict()) for review in reviews],
        retrieval_method="provider_api",
        completeness="degraded",
        note="Full scrape unavailable; fell back to Places API (max 5 reviews).",
    )


@router.post("/google-reviews/search", response_model=ReviewsResponse)
async def google_reviews_search(
    request: GoogleReviewsSearchRequest,
    authorization: Optional[str] = Header(None),
) -> ReviewsResponse:
    """Find a property on Google by name/address and fetch its reviews."""
    verify_service_key(authorization)

    try:
        from scrapers.google_places import GooglePlacesScraper
        scraper = GooglePlacesScraper()
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error))

    result = scraper.get_reviews_for_property(
        property_name=request.property_name,
        address=request.address,
        lat=request.lat,
        lng=request.lng,
    )

    if not result.get("success"):
        return ReviewsResponse(
            success=False,
            error=result.get("error") or "Property not found on Google",
            retrieval_method="provider_api",
            completeness="unknown",
        )

    return ReviewsResponse(
        success=True,
        reviews=[_to_observed(raw) for raw in result.get("reviews", [])],
        retrieval_method="provider_api",
        completeness="sample",
        note=result.get("note"),
    )


# ---------------------------------------------------------------------------
# Yelp
# ---------------------------------------------------------------------------

def _get_yelp_client_or_503():
    from scrapers.yelp import get_yelp_client

    client = get_yelp_client()
    if not client:
        raise HTTPException(
            status_code=503,
            detail="Yelp Fusion API is not configured (YELP_FUSION_API_KEY missing)",
        )
    return client


@router.post("/yelp-reviews", response_model=ReviewsResponse)
async def yelp_reviews(
    request: YelpReviewsRequest,
    authorization: Optional[str] = Header(None),
) -> ReviewsResponse:
    """Fetch reviews for a Yelp business (Fusion API returns at most 3)."""
    verify_service_key(authorization)
    client = _get_yelp_client_or_503()

    try:
        reviews = client.get_business_reviews(request.business_id)
    except Exception as error:
        logger.exception("Yelp review fetch failed for %s", request.business_id)
        raise HTTPException(status_code=502, detail=f"Yelp request failed: {error}")

    return ReviewsResponse(
        success=True,
        reviews=[_to_observed(review.to_dict()) for review in reviews],
        retrieval_method="provider_api",
        completeness="sample",
        note="Yelp Fusion API returns only the 3 most recent reviews per business.",
    )


@router.post("/yelp-reviews/from-url", response_model=ReviewsResponse)
async def yelp_reviews_from_url(
    request: YelpReviewsFromUrlRequest,
    authorization: Optional[str] = Header(None),
) -> ReviewsResponse:
    """Extract the business ID from a Yelp URL and fetch its reviews."""
    verify_service_key(authorization)
    client = _get_yelp_client_or_503()

    business_id = client.extract_business_id_from_url(request.url)
    if not business_id:
        return ReviewsResponse(
            success=False,
            error="Could not extract a Yelp business ID from the provided URL",
            retrieval_method="provider_api",
            completeness="unknown",
        )

    try:
        reviews = client.get_business_reviews(business_id)
    except Exception as error:
        logger.exception("Yelp review fetch failed for %s", business_id)
        raise HTTPException(status_code=502, detail=f"Yelp request failed: {error}")

    return ReviewsResponse(
        success=True,
        reviews=[_to_observed(review.to_dict()) for review in reviews],
        retrieval_method="provider_api",
        completeness="sample",
        note="Yelp Fusion API returns only the 3 most recent reviews per business.",
    )
