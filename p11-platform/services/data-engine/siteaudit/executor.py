"""
Site audit job executor.

Follows the PropertyAudit job pattern: atomic claim of a queued row,
heartbeat while running, checkpointing for restart resilience, and a stale
sweeper so orphaned crawls fail loudly instead of hanging forever.
"""

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from supabase import Client

from siteaudit.analyst import SiteAuditAnalyst
from siteaudit.crawler import DEFAULT_PAGE_CAP, SiteCrawler
from siteaudit.detectors import run_detectors
from siteaudit.findings import sync_findings
from siteaudit.models import CrawlContext, PageRecord

logger = logging.getLogger(__name__)

DEFAULT_HEARTBEAT_SECONDS = 60
DEFAULT_STALE_CRAWL_SECONDS = 1800  # crawls can legitimately run long
PAGE_UPSERT_BATCH = 50


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def recover_stale_crawls(supabase: Client, stale_after_seconds: Optional[int] = None) -> int:
    """Fail orphaned crawls whose heartbeat stopped (e.g. after a service restart)."""
    stale_after = stale_after_seconds or int(os.environ.get("SITEAUDIT_STALE_CRAWL_SECONDS", DEFAULT_STALE_CRAWL_SECONDS))
    cutoff = _utc_now() - timedelta(seconds=stale_after)

    response = (
        supabase.table("geo_site_crawls")
        .select("id, status, last_updated_at, started_at, pages_crawled")
        .eq("status", "running")
        .execute()
    )
    recovered = 0
    for crawl in response.data or []:
        last_seen = _parse_datetime(crawl.get("last_updated_at")) or _parse_datetime(crawl.get("started_at"))
        if not last_seen or last_seen > cutoff:
            continue
        supabase.table("geo_site_crawls").update({
            "status": "failed",
            "finished_at": _utc_now().isoformat(),
            "error_message": (
                "Data-engine heartbeat expired; crawl was likely orphaned by a service restart "
                f"after {crawl.get('pages_crawled') or 0} pages."
            ),
        }).eq("id", crawl["id"]).eq("status", "running").execute()
        recovered += 1
        logger.warning("[SiteAudit] Recovered stale crawl %s", crawl["id"])
    return recovered


class SiteAuditExecutor:
    def __init__(self, supabase: Client):
        self.supabase = supabase
        self.heartbeat_seconds = int(os.environ.get("SITEAUDIT_HEARTBEAT_SECONDS", DEFAULT_HEARTBEAT_SECONDS))
        self.concurrency = int(os.environ.get("SITEAUDIT_CRAWL_CONCURRENCY", "5"))
        self.analyst_enabled = os.environ.get("SITEAUDIT_ANALYST_ENABLED", "true").lower() != "false"

    def claim_queued_crawl(self, crawl_id: str) -> Optional[Dict[str, Any]]:
        response = self.supabase.table("geo_site_crawls").update({
            "status": "running",
            "started_at": _utc_now().isoformat(),
            "last_updated_at": _utc_now().isoformat(),
            "error_message": None,
            "finished_at": None,
        }).eq("id", crawl_id).eq("status", "queued").execute()
        if response.data:
            return response.data[0]
        return None

    def claim_resumable_crawl(self, crawl_id: str) -> Optional[Dict[str, Any]]:
        """Claim a failed crawl that has checkpoint state, for resume."""
        response = self.supabase.table("geo_site_crawls").update({
            "status": "running",
            "last_updated_at": _utc_now().isoformat(),
            "error_message": None,
            "finished_at": None,
        }).eq("id", crawl_id).eq("status", "failed").execute()
        if response.data and (response.data[0].get("crawl_state") or {}).get("frontier"):
            return response.data[0]
        return None

    async def _heartbeat(self, crawl_id: str) -> None:
        while True:
            await asyncio.sleep(self.heartbeat_seconds)
            try:
                self.supabase.table("geo_site_crawls").update({
                    "last_updated_at": _utc_now().isoformat(),
                }).eq("id", crawl_id).eq("status", "running").execute()
            except Exception as error:
                logger.warning("[SiteAudit] Heartbeat failed for %s: %s", crawl_id, error)

    def _load_existing_pages(self, crawl_id: str) -> List[PageRecord]:
        """Rebuild in-memory PageRecords from previously checkpointed rows (resume)."""
        response = (
            self.supabase.table("geo_crawl_pages")
            .select("*")
            .eq("crawl_id", crawl_id)
            .execute()
        )
        pages: List[PageRecord] = []
        for row in response.data or []:
            pages.append(PageRecord(
                url=row["url"],
                final_url=row.get("final_url"),
                status_code=row.get("status_code"),
                redirect_chain=row.get("redirect_chain") or [],
                content_type=row.get("content_type"),
                response_headers=row.get("response_headers") or {},
                title=row.get("title"),
                meta_description=row.get("meta_description"),
                meta_robots=row.get("meta_robots"),
                canonical_url=row.get("canonical_url"),
                h1s=row.get("h1s") or [],
                h2s=row.get("h2s") or [],
                word_count=row.get("word_count") or 0,
                html_bytes=row.get("html_bytes") or 0,
                text_html_ratio=row.get("text_html_ratio"),
                images=row.get("images") or [],
                internal_links=row.get("internal_links") or [],
                external_links=row.get("external_links") or [],
                structured_data=row.get("structured_data") or {},
                mixed_content=row.get("mixed_content") or [],
                blocked_resources=row.get("blocked_resources") or [],
                page_type=row.get("page_type") or "unknown",
                crawl_depth=row.get("crawl_depth") or 0,
                inlink_count=row.get("inlink_count") or 0,
                in_sitemap=bool(row.get("in_sitemap")),
                blocked_by_robots=bool(row.get("blocked_by_robots")),
                fetch_error=row.get("fetch_error"),
            ))
        return pages

    def _upsert_pages(self, crawl_id: str, pages: List[PageRecord]) -> None:
        rows = [page.to_row(crawl_id) for page in pages]
        for start in range(0, len(rows), PAGE_UPSERT_BATCH):
            batch = rows[start:start + PAGE_UPSERT_BATCH]
            self.supabase.table("geo_crawl_pages").upsert(
                batch, on_conflict="crawl_id,url"
            ).execute()

    async def execute_crawl(self, crawl_id: str, claimed_crawl: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        crawl = claimed_crawl or self.claim_queued_crawl(crawl_id)
        if not crawl:
            return {"success": False, "error": f"Crawl {crawl_id} is not queued"}

        heartbeat_task = asyncio.create_task(self._heartbeat(crawl_id))
        try:
            seed_url = crawl["seed_url"]
            page_cap = int(crawl.get("page_cap") or DEFAULT_PAGE_CAP)
            property_id = crawl["property_id"]
            batch_id = crawl.get("batch_id")

            resume_state = crawl.get("crawl_state") or {}
            resume_pages = self._load_existing_pages(crawl_id) if resume_state.get("frontier") else []

            async def checkpoint(state: Dict[str, Any], pages: List[PageRecord]) -> None:
                # Persist newly crawled pages and the frontier so a restart can resume.
                await asyncio.to_thread(self._upsert_pages, crawl_id, pages)
                await asyncio.to_thread(
                    lambda: self.supabase.table("geo_site_crawls").update({
                        "crawl_state": state,
                        "pages_crawled": state.get("pages_crawled", 0),
                        "pages_discovered": state.get("pages_crawled", 0),
                        "last_updated_at": _utc_now().isoformat(),
                    }).eq("id", crawl_id).execute()
                )

            crawler = SiteCrawler(
                seed_url=seed_url,
                page_cap=page_cap,
                concurrency=self.concurrency,
                checkpoint=checkpoint,
                resume_state=resume_state,
                resume_pages=resume_pages,
            )
            context = await crawler.crawl()

            # Final page persistence (with final inlink counts) and summaries.
            self._upsert_pages(crawl_id, context.pages)
            self.supabase.table("geo_site_crawls").update({
                "pages_crawled": len(context.pages),
                "pages_discovered": len(context.pages) + len(
                    [u for u in context.sitemap_urls if u not in {p.url for p in context.pages}]
                ),
                "robots_summary": {
                    "reachable": context.robots_reachable,
                    "blocked_url_count": len(context.robots_blocked_urls),
                    "blocked_resource_count": len(context.robots_blocked_resources),
                },
                "sitemap_summary": {
                    "reachable": context.sitemap_reachable,
                    "url_count": len(context.sitemap_urls),
                },
                "llms_txt_summary": {
                    "reachable": context.llms_txt_reachable,
                },
                "crawl_state": {"final": True},
                "last_updated_at": _utc_now().isoformat(),
            }).eq("id", crawl_id).execute()

            # Detectors + findings lifecycle
            findings = run_detectors(context)
            sync_result = sync_findings(self.supabase, property_id, crawl_id, findings)

            # LLM analysis layer
            analyst_result: Dict[str, Any] = {"success": False, "error": "disabled"}
            if self.analyst_enabled:
                analyst = SiteAuditAnalyst(self.supabase)
                analyst_result = await analyst.generate(property_id, crawl_id, batch_id)

            self.supabase.table("geo_site_crawls").update({
                "status": "completed",
                "finished_at": _utc_now().isoformat(),
                "last_updated_at": _utc_now().isoformat(),
            }).eq("id", crawl_id).execute()

            logger.info(
                "[SiteAudit] Crawl %s completed: %s pages, findings %s, analyst %s",
                crawl_id, len(context.pages), sync_result, analyst_result.get("success"),
            )
            return {
                "success": True,
                "pages_crawled": len(context.pages),
                "findings": sync_result,
                "analyst": analyst_result,
            }
        except Exception as error:
            logger.exception("[SiteAudit] Crawl %s failed: %s", crawl_id, error)
            try:
                self.supabase.table("geo_site_crawls").update({
                    "status": "failed",
                    "finished_at": _utc_now().isoformat(),
                    "error_message": str(error)[:2000],
                }).eq("id", crawl_id).execute()
            except Exception:
                pass
            return {"success": False, "error": str(error)}
        finally:
            heartbeat_task.cancel()
