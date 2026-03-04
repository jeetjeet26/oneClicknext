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
import os

# Import routers
from routers.brand_intelligence import router as brand_intelligence_router
from routers.crm_integration import router as crm_integration_router
from routers.scraper import router as scraper_router

app = FastAPI(title="P11 Data Engine", version="1.0.0")

# Mount routers
app.include_router(brand_intelligence_router)
app.include_router(crm_integration_router)
app.include_router(scraper_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Authentication
def verify_api_key(authorization: Optional[str] = Header(None)):
    """Verify API key from Authorization header."""
    expected_key = os.environ.get("DATA_ENGINE_API_KEY")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization")
    
    token = authorization.replace("Bearer ", "")
    if token != expected_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return True


# ============================================
# Marketing Data Sync Endpoints
# ============================================

class SyncMarketingRequest(BaseModel):
    property_id: str
    channels: List[str] = ["google_ads", "meta_ads"]
    date_range: str = "LAST_7_DAYS"

class SyncAllRequest(BaseModel):
    date_range: str = "LAST_7_DAYS"

@app.post("/sync-marketing-data")
async def sync_marketing_data(
    request: SyncMarketingRequest,
    background_tasks: BackgroundTasks,
    authorized: bool = Depends(verify_api_key)
):
    """
    Trigger marketing data sync for a specific property.
    Runs in background to avoid timeout.
    Creates import_job for tracking.
    """
    from pipelines.mcp_marketing_sync import MCPMarketingSync
    from utils.supabase_client import get_supabase_client
    from datetime import datetime
    
    # Create import job
    supabase = get_supabase_client()
    job_result = supabase.table('import_jobs').insert({
        'property_id': request.property_id,
        'channels': request.channels,
        'date_range': request.date_range,
        'status': 'pending',
        'progress_pct': 0,
        'created_at': datetime.utcnow().isoformat()
    }).execute()
    
    job_id = job_result.data[0]['id'] if job_result.data else None
    
    async def run_sync():
        try:
            syncer = MCPMarketingSync(job_id=job_id)
            # Don't pass date_range to let incremental calculation work
            # This uses MAXIMUM for first-time imports, then calculates based on last_import
            await syncer.sync_property(
                property_id=request.property_id,
                channels=request.channels,
                date_range=None,  # Let sync_property calculate based on last import
                incremental=True
            )
        except Exception as e:
            print(f"Sync error: {e}")
            if job_id:
                supabase.table('import_jobs').update({
                    'status': 'failed',
                    'error_message': str(e),
                    'completed_at': datetime.utcnow().isoformat()
                }).eq('id', job_id).execute()
    
    background_tasks.add_task(run_sync)
    
    return {
        "status": "import_started",
        "job_id": job_id,
        "property_id": request.property_id,
        "channels": request.channels,
    }

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
    from pipelines.mcp_marketing_sync import MCPMarketingSync
    
    async def run_sync():
        syncer = MCPMarketingSync()
        await syncer.sync_all_properties()
    
    background_tasks.add_task(run_sync)
    
    return {
        "status": "sync_started",
        "message": "Syncing all properties in background"
    }


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
