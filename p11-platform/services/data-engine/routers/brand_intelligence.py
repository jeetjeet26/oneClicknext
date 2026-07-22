"""
Brand Intelligence API Router
Exposes brand intelligence scraper functionality via REST API

All endpoints require the shared data-engine API key (X-API-Key header) and
re-validate property/competitor membership inside the service-role boundary.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List
import logging

from utils.auth import verify_api_key
from utils.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/scraper/brand-intelligence",
    tags=["Brand Intelligence"],
    dependencies=[Depends(verify_api_key)],
)


def verify_competitors_in_property(supabase, competitor_ids: List[str], property_id: str) -> None:
    """
    Ensure every competitor id belongs to the given property.

    Raises HTTPException(404) if any id is missing or belongs to another
    property. This re-validates tenancy inside the service-role boundary.
    """
    if not competitor_ids:
        return
    result = (
        supabase.table('competitors')
        .select('id')
        .eq('property_id', property_id)
        .in_('id', competitor_ids)
        .execute()
    )
    found_ids = {row['id'] for row in (result.data or [])}
    missing = [cid for cid in competitor_ids if cid not in found_ids]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Competitors not found for this property: {', '.join(missing[:5])}",
        )


# ============================================
# Request/Response Models
# ============================================

class ExtractRequest(BaseModel):
    """Request to trigger brand intelligence extraction"""
    property_id: str
    competitor_ids: Optional[List[str]] = None
    force_refresh: bool = False


class BatchRequest(BaseModel):
    """Request to batch process competitors"""
    property_id: str
    competitor_ids: List[str]
    force_refresh: bool = False


class SearchRequest(BaseModel):
    """Request for semantic search across competitor content"""
    query: str
    property_id: str
    competitor_ids: Optional[List[str]] = None
    limit: int = 10
    threshold: float = 0.7


# ============================================
# API Endpoints
# ============================================

@router.get("/property/{property_id}")
async def get_brand_intelligence_for_property(
    property_id: str,
    include_raw: bool = False
):
    """
    Get brand intelligence for all competitors of a property.
    
    Args:
        property_id: Property UUID
        include_raw: Include raw extraction data
        
    Returns:
        List of brand intelligence for each competitor
    """
    try:
        supabase = get_supabase_client()
        
        # Get competitors for this property
        competitors_result = supabase.table('competitors').select(
            'id, name, website_url'
        ).eq('property_id', property_id).execute()
        
        if not competitors_result.data:
            return {
                "success": True,
                "count": 0,
                "competitors": [],
                "message": "No competitors found for this property"
            }
        
        competitor_ids = [c['id'] for c in competitors_result.data]
        competitor_map = {c['id']: c for c in competitors_result.data}
        
        # Get brand intelligence for these competitors
        select_fields = '*' if include_raw else (
            'id, competitor_id, brand_voice, brand_personality, positioning_statement, '
            'target_audience, unique_selling_points, highlighted_amenities, service_offerings, '
            'lifestyle_focus, community_events, active_specials, promotional_messaging, '
            'urgency_tactics, website_tone, key_messaging_themes, call_to_action_patterns, '
            'sentiment_score, confidence_score, pages_analyzed, last_analyzed_at, analysis_version'
        )
        
        intel_result = supabase.table('competitor_brand_intelligence').select(
            select_fields
        ).in_('competitor_id', competitor_ids).execute()
        
        # Merge competitor info with brand intelligence
        result_data = []
        for intel in (intel_result.data or []):
            competitor = competitor_map.get(intel['competitor_id'], {})
            result_data.append({
                **intel,
                'competitor_name': competitor.get('name'),
                'website_url': competitor.get('website_url')
            })
        
        return {
            "success": True,
            "count": len(result_data),
            "competitors": result_data
        }
        
    except Exception as e:
        logger.error(f"Error fetching brand intelligence: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
async def trigger_brand_intelligence_extraction(
    request: ExtractRequest,
    background_tasks: BackgroundTasks
):
    """
    Trigger brand intelligence extraction for a property's competitors.
    Runs in background and returns a job ID for tracking.
    
    Args:
        request: Extraction request with property_id and optional competitor_ids
        
    Returns:
        Job ID for tracking progress
    """
    try:
        from scrapers.brand_intelligence import CompetitorBatchProcessor
        
        supabase = get_supabase_client()
        
        # Get competitors to process
        if request.competitor_ids:
            verify_competitors_in_property(supabase, request.competitor_ids, request.property_id)
            competitor_ids = request.competitor_ids
        else:
            # Get all competitors for the property
            result = supabase.table('competitors').select('id').eq(
                'property_id', request.property_id
            ).execute()
            competitor_ids = [c['id'] for c in (result.data or [])]
        
        if not competitor_ids:
            return {
                "success": True,
                "message": "No competitors to process",
                "data": {"job_id": None}
            }
        
        # Create processor and job
        processor = CompetitorBatchProcessor()
        job_id = processor.create_job(request.property_id, competitor_ids)
        
        # Run processing in background
        async def run_extraction():
            try:
                await processor.process_job(job_id, force_refresh=request.force_refresh)
            except Exception as e:
                logger.error(f"Background extraction failed: {e}")
        
        background_tasks.add_task(run_extraction)
        
        return {
            "success": True,
            "message": "Brand intelligence extraction started",
            "data": {
                "job_id": job_id,
                "competitor_count": len(competitor_ids)
            }
        }
        
    except Exception as e:
        logger.error(f"Error triggering extraction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/competitor/{competitor_id}")
async def get_competitor_brand_intelligence(
    competitor_id: str,
    property_id: str,
    include_raw: bool = False
):
    """
    Get brand intelligence for a single competitor.
    
    Args:
        competitor_id: Competitor UUID
        property_id: Property UUID the competitor must belong to
        include_raw: Include raw extraction data
        
    Returns:
        Brand intelligence data for the competitor
    """
    try:
        supabase = get_supabase_client()
        
        # Get competitor info scoped to the property (tenancy re-check)
        competitor_result = supabase.table('competitors').select(
            'id, name, website_url'
        ).eq('id', competitor_id).eq('property_id', property_id).execute()
        
        if not competitor_result.data:
            raise HTTPException(status_code=404, detail="Competitor not found for this property")
        
        competitor = competitor_result.data[0]
        
        # Get brand intelligence
        select_fields = '*' if include_raw else (
            'id, competitor_id, brand_voice, brand_personality, positioning_statement, '
            'target_audience, unique_selling_points, highlighted_amenities, service_offerings, '
            'lifestyle_focus, community_events, active_specials, promotional_messaging, '
            'urgency_tactics, website_tone, key_messaging_themes, call_to_action_patterns, '
            'sentiment_score, confidence_score, pages_analyzed, last_analyzed_at, analysis_version'
        )
        
        intel_result = supabase.table('competitor_brand_intelligence').select(
            select_fields
        ).eq('competitor_id', competitor_id).limit(1).execute()
        
        if not intel_result.data:
            return {
                "success": True,
                "data": None,
                "message": "No brand intelligence available. Trigger extraction first."
            }
        
        return {
            "success": True,
            "data": {
                **intel_result.data[0],
                'competitor_name': competitor.get('name'),
                'website_url': competitor.get('website_url')
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching competitor intelligence: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/job/{job_id}")
async def get_job_status(job_id: str, property_id: Optional[str] = None):
    """
    Get the status of a brand intelligence extraction job.
    
    Args:
        job_id: Job UUID
        property_id: Optional property UUID; when provided, the job must belong to it
        
    Returns:
        Job status and progress
    """
    try:
        from scrapers.brand_intelligence import CompetitorBatchProcessor
        
        if property_id:
            supabase = get_supabase_client()
            job_check = (
                supabase.table('competitor_scrape_jobs')
                .select('id')
                .eq('id', job_id)
                .eq('property_id', property_id)
                .execute()
            )
            if not job_check.data:
                raise HTTPException(status_code=404, detail="Job not found for this property")
        
        processor = CompetitorBatchProcessor()
        status = processor.get_job_status(job_id)
        
        if 'error' in status:
            raise HTTPException(status_code=404, detail=status['error'])
        
        return {
            "success": True,
            "data": status
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching job status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch")
async def batch_extract_brand_intelligence(
    request: BatchRequest,
    background_tasks: BackgroundTasks
):
    """
    Batch process multiple competitors for brand intelligence.
    
    Args:
        request: Batch request with property_id and competitor_ids
        
    Returns:
        Job ID for tracking progress
    """
    try:
        from scrapers.brand_intelligence import CompetitorBatchProcessor
        
        if not request.competitor_ids:
            return {
                "success": True,
                "message": "No competitors to process",
                "data": {"job_id": None}
            }
        
        verify_competitors_in_property(
            get_supabase_client(), request.competitor_ids, request.property_id
        )
        
        # Create processor and job
        processor = CompetitorBatchProcessor()
        job_id = processor.create_job(request.property_id, request.competitor_ids)
        
        # Run processing in background
        async def run_batch():
            try:
                await processor.process_job(job_id, force_refresh=request.force_refresh)
            except Exception as e:
                logger.error(f"Background batch processing failed: {e}")
        
        background_tasks.add_task(run_batch)
        
        return {
            "success": True,
            "message": "Batch extraction started",
            "data": {
                "job_id": job_id,
                "competitor_count": len(request.competitor_ids)
            }
        }
        
    except Exception as e:
        logger.error(f"Error starting batch extraction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search")
async def search_competitor_content(request: SearchRequest):
    """
    Semantic search across competitor content chunks.
    
    Args:
        request: Search request with query and optional filters
        
    Returns:
        Matching content chunks with similarity scores
    """
    try:
        from scrapers.brand_intelligence import SemanticSearchService
        
        if request.competitor_ids:
            verify_competitors_in_property(
                get_supabase_client(), request.competitor_ids, request.property_id
            )
        
        search_service = SemanticSearchService()
        
        results = await search_service.search(
            query=request.query,
            property_id=request.property_id,
            competitor_ids=request.competitor_ids,
            limit=request.limit,
            threshold=request.threshold
        )
        
        return {
            "success": True,
            "count": len(results),
            "results": results
        }
        
    except Exception as e:
        logger.error(f"Error in semantic search: {e}")
        raise HTTPException(status_code=500, detail=str(e))


