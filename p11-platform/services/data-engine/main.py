"""
Data Engine API - Main FastAPI application
Handles property audits, reviews, and marketing data sync
"""
# Load environment FIRST before any other imports that might need env vars
from utils.config import SUPABASE_URL  # This triggers .env loading

from fastapi import FastAPI, HTTPException, Header, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import asyncio
import logging
import os

# Import routers
from routers.brand_intelligence import router as brand_intelligence_router
from routers.competitor_intake import router as competitor_intake_router
from routers.crm_integration import router as crm_integration_router
from routers.propertyaudit_jobs import router as propertyaudit_jobs_router
from routers.reviews import router as reviews_router
from routers.marketing_import import router as marketing_import_router
from routers.scraper import router as scraper_router
from routers.siteaudit_jobs import router as siteaudit_jobs_router
from jobs.propertyaudit import recover_stale_running_runs
from siteaudit.executor import recover_stale_crawls
from utils.supabase_client import get_supabase_client

app = FastAPI(title="P11 Data Engine", version="1.0.0")
logger = logging.getLogger(__name__)

# Mount routers
app.include_router(brand_intelligence_router)
app.include_router(competitor_intake_router)
app.include_router(crm_integration_router)
app.include_router(propertyaudit_jobs_router)
app.include_router(reviews_router)
app.include_router(marketing_import_router)
app.include_router(scraper_router)
app.include_router(siteaudit_jobs_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _propertyaudit_stale_run_sweeper():
    try:
        interval_seconds = int(os.environ.get("PROPERTYAUDIT_STALE_SWEEP_SECONDS", "60"))
    except ValueError:
        interval_seconds = 60
    while True:
        try:
            recovered = recover_stale_running_runs(get_supabase_client())
            if recovered:
                logger.warning("[PropertyAudit] Recovered %s stale running run(s)", recovered)
        except Exception as error:
            logger.exception("[PropertyAudit] Stale run recovery failed: %s", error)
        try:
            recovered_crawls = recover_stale_crawls(get_supabase_client())
            if recovered_crawls:
                logger.warning("[SiteAudit] Recovered %s stale crawl(s)", recovered_crawls)
        except Exception as error:
            logger.exception("[SiteAudit] Stale crawl recovery failed: %s", error)
        await asyncio.sleep(max(10, interval_seconds))


@app.on_event("startup")
async def start_propertyaudit_recovery():
    asyncio.create_task(_propertyaudit_stale_run_sweeper())
    from jobs.geo_durable import durable_geo_worker
    if os.environ.get('PROPERTYAUDIT_WORKER_ENABLED', 'true').lower() == 'true':
        app.state.geo_worker = asyncio.create_task(durable_geo_worker())
    from jobs.marketing_import import marketing_import_worker, worker_enabled
    if worker_enabled():
        app.state.marketing_import_worker = asyncio.create_task(marketing_import_worker())


@app.on_event("shutdown")
async def stop_marketing_import_worker():
    import contextlib
    geo_task = getattr(app.state, 'geo_worker', None)
    if geo_task:
        geo_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await geo_task
    task = getattr(app.state, 'marketing_import_worker', None)
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


# Authentication
def verify_api_key(authorization: Optional[str] = Header(None)):
    """Verify API key from Authorization header."""
    from utils.auth import verify_service_key
    verify_service_key(authorization)
    return True


# ============================================
# Marketing Data Sync Endpoints
# ============================================

class SyncAllRequest(BaseModel):
    date_range: str = "LAST_7_DAYS"

@app.post("/sync-all-properties")
async def sync_all_properties(
    request: SyncAllRequest,
    background_tasks: BackgroundTasks,
    authorized: bool = Depends(verify_api_key)
):
    """
    Trigger marketing data sync for all properties.
    Runs in background.
    """
    raise HTTPException(409, 'Choose explicit properties and use tracked /sync-marketing-data imports. Untracked bulk sync is disabled.')



# ============================================
# Health Check
# ============================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "p11-data-engine",
        "version": "1.0.0"
    }

@app.get("/import-jobs/{job_id}")
async def get_import_job(job_id: str, authorized: bool = Depends(verify_api_key)):
    """Get import job status."""
    from utils.supabase_client import get_supabase_client
    
    supabase = get_supabase_client()
    result = supabase.table('import_jobs').select('*').eq('id', job_id).single().execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return result.data

@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "P11 Data Engine",
        "version": "1.0.0",
        "endpoints": {
            "health": "GET /health",
            "sync_property": "POST /sync-marketing-data",
            "sync_all": "POST /sync-all-properties",
            "job_status": "GET /import-jobs/{job_id}",
            "scraper": {
                "discover": "POST /scraper/discover",
                "refresh_pricing": "POST /scraper/refresh-pricing",
                "website_batch": "POST /scraper/website/batch",
                "website_refresh": "POST /scraper/website/refresh",
                "apartments_batch": "POST /scraper/apartments-com/batch",
                "apartments_refresh": "POST /scraper/apartments-com/refresh",
                "apartments_discover": "POST /scraper/apartments-com/discover",
                "apartments_find": "POST /scraper/apartments-com/find-listings",
                "status": "GET /scraper/status"
            },
            "brand_intelligence": {
                "get_for_property": "GET /scraper/brand-intelligence/property/{property_id}",
                "get_for_competitor": "GET /scraper/brand-intelligence/competitor/{competitor_id}",
                "trigger_extraction": "POST /scraper/brand-intelligence",
                "batch_extraction": "POST /scraper/brand-intelligence/batch",
                "job_status": "GET /scraper/brand-intelligence/job/{job_id}",
                "search": "POST /scraper/brand-intelligence/search"
            },
            "crm_integration": {
                "test_connection": "POST /crm/test-connection",
                "discover_schema": "POST /crm/discover-schema",
                "search_lead": "POST /crm/search-lead",
                "push_lead": "POST /crm/push-lead",
                "validate_mapping": "POST /crm/validate-mapping",
                "save_mapping": "POST /crm/save-mapping",
                "learned_patterns": "GET /crm/learned-patterns/{crm_type}",
                "tourspark_schema": "GET /crm/tourspark-schema"
            }
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
