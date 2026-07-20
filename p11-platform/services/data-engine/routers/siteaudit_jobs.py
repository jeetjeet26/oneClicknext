"""
Site audit job router.
Exposes full-site crawl execution endpoints used by the Next.js app.
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from siteaudit.executor import SiteAuditExecutor
from utils.auth import verify_api_key
from utils.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs/siteaudit", tags=["SiteAudit"])


class CrawlRequest(BaseModel):
    crawl_id: str
    resume: bool = False


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


def _execute_siteaudit_job(crawl_id: str, claimed_crawl: dict):
    """Run the crawl off the request event loop (same pattern as PropertyAudit)."""

    async def runner():
        supabase = get_supabase_client()
        executor = SiteAuditExecutor(supabase)
        try:
            await executor.execute_crawl(crawl_id, claimed_crawl=claimed_crawl)
        except Exception as error:
            logger.exception("[SiteAudit] Background crawl failed for %s: %s", crawl_id, error)

    asyncio.run(runner())


@router.post("/run")
async def run_siteaudit(
    request: CrawlRequest,
    _: str = Depends(verify_api_key),
):
    supabase = get_supabase_client()
    executor = SiteAuditExecutor(supabase)

    claimed = executor.claim_queued_crawl(request.crawl_id)
    if not claimed and request.resume:
        claimed = executor.claim_resumable_crawl(request.crawl_id)

    if not claimed:
        crawl = _get_crawl_or_404(request.crawl_id)
        raise HTTPException(
            status_code=409,
            detail=f"Crawl {request.crawl_id} is not queued (status={crawl.get('status')})",
        )

    asyncio.create_task(
        asyncio.to_thread(_execute_siteaudit_job, request.crawl_id, claimed)
    )

    return {
        "success": True,
        "accepted": True,
        "crawl_id": request.crawl_id,
        "status": "running",
    }


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
