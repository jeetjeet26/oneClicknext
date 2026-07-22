"""
Scraper Router
Exposes competitor discovery and scraping endpoints

All endpoints require the shared data-engine API key (X-API-Key header) and
re-validate property/competitor membership inside the service-role boundary.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import logging

from scrapers.coordinator import ScrapingCoordinator
from utils.auth import verify_api_key
from utils.supabase_client import get_supabase_client
from utils.url_safety import is_apartments_com_url, is_safe_public_url

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/scraper",
    tags=["scraper"],
    dependencies=[Depends(verify_api_key)],
)


def verify_competitor_in_property(supabase, competitor_id: str, property_id: str) -> dict:
    """
    Ensure the competitor exists and belongs to the given property.

    Raises HTTPException(404) when the competitor does not exist or is not
    part of the property. Returns the competitor row on success.
    """
    result = (
        supabase.table('competitors')
        .select('id, name, property_id, website_url, ils_listings')
        .eq('id', competitor_id)
        .eq('property_id', property_id)
        .execute()
    )
    rows = result.data or []
    if not rows:
        raise HTTPException(
            status_code=404,
            detail="Competitor not found for this property",
        )
    return rows[0]


# ============================================
# Request/Response Models
# ============================================

class DiscoverRequest(BaseModel):
    property_id: str
    radius_miles: float = 3.0
    max_competitors: int = 20
    auto_add: bool = True


class RefreshPricingRequest(BaseModel):
    property_id: str
    prefer_website: bool = True


class WebsiteBatchRequest(BaseModel):
    property_id: str
    competitor_ids: Optional[List[str]] = None


class WebsiteRefreshRequest(BaseModel):
    property_id: str
    competitor_id: str
    url: Optional[str] = None


class ApartmentsBatchRequest(BaseModel):
    property_id: str
    competitor_ids: Optional[List[str]] = None


class ApartmentsRefreshRequest(BaseModel):
    property_id: str
    competitor_id: str
    url: Optional[str] = None


class ApartmentsDiscoverRequest(BaseModel):
    property_id: str
    city: str
    state: str
    max_results: int = 20
    auto_add: bool = True


class ApartmentsFindListingsRequest(BaseModel):
    property_id: str
    competitor_ids: Optional[List[str]] = None
    auto_scrape: bool = True
    city: Optional[str] = None
    state: Optional[str] = None
    search_strategy: str = "name"


# ============================================
# Discovery Endpoints
# ============================================

@router.post("/discover")
async def discover_competitors(request: DiscoverRequest):
    """
    Discover competitors near a property using Google Places and/or Apartments.com.

    Uses intelligent filtering based on property_type to find relevant competitors.
    """
    try:
        coordinator = ScrapingCoordinator()

        # Run discovery (can take time with Google Places API)
        result = coordinator.discover_competitors_for_property(
            property_id=request.property_id,
            radius_miles=request.radius_miles,
            max_competitors=request.max_competitors,
            auto_add=request.auto_add
        )

        if not result.get('success'):
            raise HTTPException(status_code=400, detail=result.get('error', 'Discovery failed'))

        return {
            'success': True,
            'data': result
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Discovery error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Pricing Refresh Endpoints
# ============================================

@router.post("/refresh-pricing")
async def refresh_pricing(request: RefreshPricingRequest):
    """
    Refresh pricing data for all competitors.

    Prioritizes competitor websites over ILS listings (apartments.com).
    """
    try:
        coordinator = ScrapingCoordinator()

        result = coordinator.refresh_all_competitors(
            property_id=request.property_id,
            prefer_website=request.prefer_website
        )

        return result

    except Exception as e:
        logger.error(f"Refresh pricing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Website Scraping Endpoints
# ============================================

@router.post("/website/batch")
async def refresh_websites_batch(request: WebsiteBatchRequest):
    """
    Batch refresh pricing from competitor websites.

    Scrapes floor plans and pricing directly from competitor websites.
    """
    try:
        coordinator = ScrapingCoordinator()

        result = coordinator.batch_refresh_from_website(
            property_id=request.property_id,
            competitor_ids=request.competitor_ids
        )

        return result

    except Exception as e:
        logger.error(f"Website batch refresh error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/website/refresh")
async def refresh_website_single(request: WebsiteRefreshRequest):
    """
    Refresh a single competitor from their website.
    """
    try:
        supabase = get_supabase_client()
        verify_competitor_in_property(supabase, request.competitor_id, request.property_id)

        if request.url is not None and not is_safe_public_url(request.url):
            raise HTTPException(status_code=400, detail="URL must be a public http(s) address")

        coordinator = ScrapingCoordinator()

        result = coordinator.refresh_competitor_from_website(
            competitor_id=request.competitor_id,
            website_url=request.url
        )

        if not result.get('success'):
            raise HTTPException(status_code=400, detail=result.get('error', 'Refresh failed'))

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Website refresh error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Apartments.com Endpoints
# ============================================

@router.post("/apartments-com/batch")
async def refresh_apartments_batch(request: ApartmentsBatchRequest):
    """
    Batch refresh pricing from apartments.com.

    Uses Apify for reliable scraping.
    """
    try:
        coordinator = ScrapingCoordinator()

        result = coordinator.batch_refresh_from_apartments_com(
            property_id=request.property_id,
            competitor_ids=request.competitor_ids
        )

        if not result.get('success'):
            raise HTTPException(status_code=400, detail=result.get('error', 'Batch refresh failed'))

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Apartments.com batch refresh error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/apartments-com/refresh")
async def refresh_apartments_single(request: ApartmentsRefreshRequest):
    """
    Refresh a single competitor from apartments.com.
    """
    try:
        supabase = get_supabase_client()
        verify_competitor_in_property(supabase, request.competitor_id, request.property_id)

        if request.url is not None and not is_apartments_com_url(request.url):
            raise HTTPException(
                status_code=400,
                detail="URL must be an apartments.com listing (hostname apartments.com)",
            )

        coordinator = ScrapingCoordinator()

        result = coordinator.refresh_competitor_from_apartments_com(
            competitor_id=request.competitor_id,
            apartments_com_url=request.url
        )

        if not result.get('success'):
            raise HTTPException(status_code=400, detail=result.get('error', 'Refresh failed'))

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Apartments.com refresh error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/apartments-com/discover")
async def discover_apartments(request: ApartmentsDiscoverRequest):
    """
    Discover competitors from apartments.com search.

    Searches apartments.com by city/state and adds found properties.
    """
    try:
        coordinator = ScrapingCoordinator()

        result = coordinator.discover_and_scrape_apartments_com(
            property_id=request.property_id,
            city=request.city,
            state=request.state,
            max_results=request.max_results,
            auto_add=request.auto_add
        )

        if not result.get('success'):
            raise HTTPException(status_code=400, detail=result.get('error', 'Discovery failed'))

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Apartments.com discovery error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/apartments-com/find-listings")
async def find_apartments_listings(request: ApartmentsFindListingsRequest):
    """
    Find apartments.com listings for existing competitors.

    Searches apartments.com to match existing competitors with their listings.
    """
    try:
        coordinator = ScrapingCoordinator()

        result = await coordinator.find_apartments_com_listings(
            property_id=request.property_id,
            competitor_ids=request.competitor_ids,
            auto_scrape=request.auto_scrape,
            city_override=request.city,
            state_override=request.state,
            search_strategy=request.search_strategy
        )

        if not result.get('success'):
            raise HTTPException(status_code=400, detail=result.get('error', 'Find listings failed'))

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Find apartments listings error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Status Endpoint
# ============================================

@router.get("/status")
async def get_scraper_status():
    """
    Get scraper service status.
    """
    try:
        return {
            'status': 'healthy',
            'service': 'scraper',
            'available_endpoints': [
                '/scraper/discover',
                '/scraper/refresh-pricing',
                '/scraper/website/batch',
                '/scraper/website/refresh',
                '/scraper/apartments-com/batch',
                '/scraper/apartments-com/refresh',
                '/scraper/apartments-com/discover',
                '/scraper/apartments-com/find-listings'
            ]
        }
    except Exception as e:
        logger.error(f"Status check error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
