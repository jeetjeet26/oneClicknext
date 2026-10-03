"""
Site audit job router.
Exposes full-site crawl execution endpoints used by the Next.js app.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from siteaudit.executor import SiteAuditExecutor
from siteaudit.migration_manifest import build_migration_manifest
from utils.auth import verify_api_key
from utils.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs/siteaudit", tags=["SiteAudit"])


class CrawlRequest(BaseModel):
    crawl_id: str
    resume: bool = False


class ManifestRequest(BaseModel):
    crawl_id: str
    target_url: str


class AnalyzeRequest(BaseModel):
    crawl_id: str


def _get_crawl_or_404(crawl_id: str) -> dict:
    supabase = get_supabase_client()
    result = (
        supabase.table("geo_site_crawls")
        .select(
            "id, status, property_id, seed_url, page_cap, pages_discovered, pages_crawled, "
            "error_message, started_at, finished_at, batch_id, last_updated_at"
        )
        .eq("id", crawl_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Crawl not found")
    return result.data


@router.post("/run")
async def run_siteaudit(
    request: CrawlRequest,
    _: str = Depends(verify_api_key),
):
    raise HTTPException(status_code=410, detail="Use the console's recorded audit request and durable crawl worker")


@router.post("/analyze")
async def analyze_siteaudit(
    request: AnalyzeRequest,
    _: str = Depends(verify_api_key),
):
    raise HTTPException(status_code=410, detail="Use the console's saved recommendation request and review flow")


@router.get("/status/{crawl_id}")
async def get_siteaudit_status(
    crawl_id: str,
    _: str = Depends(verify_api_key),
):
    crawl = _get_crawl_or_404(crawl_id)
    return {
        "success": True,
        "crawl_id": crawl["id"],
        "status": crawl.get("status"),
        "property_id": crawl.get("property_id"),
        "seed_url": crawl.get("seed_url"),
        "page_cap": crawl.get("page_cap"),
        "pages_discovered": crawl.get("pages_discovered"),
        "pages_crawled": crawl.get("pages_crawled"),
        "error_message": crawl.get("error_message"),
        "started_at": crawl.get("started_at"),
        "finished_at": crawl.get("finished_at"),
        "batch_id": crawl.get("batch_id"),
    }


@router.post("/manifest")
async def generate_migration_manifest(
    request: ManifestRequest,
    _: str = Depends(verify_api_key),
):
    crawl = _get_crawl_or_404(request.crawl_id)
    if crawl.get("status") != "completed":
        raise HTTPException(
            status_code=409,
            detail=f"Crawl {request.crawl_id} is not completed",
        )
    executor = SiteAuditExecutor(get_supabase_client())
    context = executor.load_persisted_context(crawl)
    if not context.pages:
        raise HTTPException(
            status_code=409,
            detail=f"Crawl {request.crawl_id} has no persisted pages",
        )
    try:
        manifest = build_migration_manifest(
            context,
            request.target_url,
            str(crawl["property_id"]),
            crawl_id=request.crawl_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"success": True, "manifest": manifest}
