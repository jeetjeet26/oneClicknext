"""
Full-site async crawler.

BFS over same-origin URLs from a seed, with:
- configurable page cap and concurrency
- robots.txt rule parsing (evaluated per URL, and against page resources)
- sitemap.xml inventory (diffed against the crawl by the detectors)
- per-URL capture via page_parser
- image byte sizes via sampled HEAD requests
- checkpointing hook so long crawls survive service restarts
"""

import asyncio
import ipaddress
import logging
import re
import urllib.robotparser
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set, Tuple
from urllib.parse import urljoin, urlparse

import httpx

from siteaudit.models import CrawlContext, PageRecord
from siteaudit.page_parser import extract_security_headers, is_same_origin, normalize_url, parse_page

logger = logging.getLogger(__name__)

DEFAULT_PAGE_CAP = 500
DEFAULT_CONCURRENCY = 5
FETCH_TIMEOUT_SECONDS = 15
POLITENESS_DELAY_SECONDS = 0.15
IMAGE_HEAD_SAMPLE_CAP = 250
CHECKPOINT_EVERY_PAGES = 25

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 P11SiteAudit/1.0"
)


def is_safe_public_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    if not host or host == "localhost" or host.endswith(".localhost"):
        return False
    try:
        address = ipaddress.ip_address(host)
        return not (address.is_private or address.is_loopback or address.is_link_local or address.is_reserved)
    except ValueError:
        return True  # hostname, not an IP literal


def normalize_seed(raw: str) -> Optional[str]:
    value = (raw or "").strip()
    if not value:
        return None
    if not re.match(r"^https?://", value, re.IGNORECASE):
        value = f"https://{value}"
    if not is_safe_public_url(value):
        return None
    parsed = urlparse(value)
    return parsed._replace(fragment="", query="").geturl()


class SiteCrawler:
    def __init__(
        self,
        seed_url: str,
        page_cap: int = DEFAULT_PAGE_CAP,
        concurrency: int = DEFAULT_CONCURRENCY,
        checkpoint: Optional[Callable[[Dict[str, Any], List[PageRecord]], Awaitable[None]]] = None,
        resume_state: Optional[Dict[str, Any]] = None,
        resume_pages: Optional[List[PageRecord]] = None,
    ):
        normalized = normalize_seed(seed_url)
        if not normalized:
            raise ValueError(f"Seed URL is not a safe public URL: {seed_url}")
        self.seed_url = normalized
        parsed = urlparse(normalized)
        self.origin = f"{parsed.scheme}://{parsed.netloc}"
        self.page_cap = max(1, page_cap)
        self.concurrency = max(1, concurrency)
        self.checkpoint = checkpoint
        self._resume_state = resume_state or {}
        self._resume_pages = resume_pages or []

        self.robots = urllib.robotparser.RobotFileParser()
        self.robots_reachable = False
        self.robots_raw: Optional[str] = None
        self.sitemap_reachable = False
        self.sitemap_urls: List[str] = []
        self.llms_txt_reachable = False
        self.llms_txt_preview: Optional[str] = None
        self.parameter_urls_discovered = 0

        self._pages: Dict[str, PageRecord] = {}
        self._frontier: List[Tuple[str, int]] = []  # (url, depth)
        self._enqueued: Set[str] = set()
        self._pages_since_checkpoint = 0

    # ------------------------------------------------------------------
    # Discovery files
    # ------------------------------------------------------------------

    async def _load_discovery_files(self, client: httpx.AsyncClient) -> None:
        robots_url = urljoin(self.origin, "/robots.txt")
        try:
            response = await client.get(robots_url)
            if response.status_code == 200 and response.text:
                self.robots_reachable = True
                self.robots_raw = response.text[:50000]
                self.robots.parse(self.robots_raw.splitlines())
            else:
                self.robots.parse([])
        except httpx.HTTPError:
            self.robots.parse([])

        sitemap_candidates = [urljoin(self.origin, "/sitemap.xml")]
        if self.robots_raw:
            for line in self.robots_raw.splitlines():
                match = re.match(r"^\s*sitemap:\s*(\S+)", line, re.IGNORECASE)
                if match:
                    sitemap_candidates.append(match.group(1))

        seen_sitemaps: Set[str] = set()
        for sitemap_url in sitemap_candidates:
            await self._load_sitemap(client, sitemap_url, seen_sitemaps)

        try:
            response = await client.get(urljoin(self.origin, "/llms.txt"))
            if response.status_code == 200 and response.text:
                content_type = response.headers.get("content-type", "")
                if "html" not in content_type.lower():
                    self.llms_txt_reachable = True
                    self.llms_txt_preview = response.text[:2000]
        except httpx.HTTPError:
            pass

    async def _load_sitemap(self, client: httpx.AsyncClient, sitemap_url: str, seen: Set[str], depth: int = 0) -> None:
        if depth > 2 or sitemap_url in seen or len(seen) > 50:
            return
        seen.add(sitemap_url)
        try:
            response = await client.get(sitemap_url)
        except httpx.HTTPError:
            return
        if response.status_code != 200 or not response.text:
            return
        self.sitemap_reachable = True
        body = response.text
        # Nested sitemap index files
        if "<sitemapindex" in body[:2000].lower():
            for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", body):
                await self._load_sitemap(client, loc.strip(), seen, depth + 1)
            return
        for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", body):
            normalized = normalize_url(loc.strip(), self.origin)
            if normalized and is_same_origin(normalized, self.origin):
                if normalized not in self.sitemap_urls:
                    self.sitemap_urls.append(normalized)

    # ------------------------------------------------------------------
    # Robots evaluation
    # ------------------------------------------------------------------

    def _robots_allows(self, url: str) -> bool:
        if not self.robots_reachable:
            return True
        try:
            return self.robots.can_fetch("*", url)
        except Exception:
            return True

    # ------------------------------------------------------------------
    # Crawl loop
    # ------------------------------------------------------------------

    def _enqueue(self, url: str, depth: int) -> None:
        if url in self._enqueued:
            return
        parsed = urlparse(url)
        if parsed.query:
            self.parameter_urls_discovered += 1
        self._enqueued.add(url)
        self._frontier.append((url, depth))

    async def crawl(self) -> CrawlContext:
        limits = httpx.Limits(max_connections=self.concurrency * 2, max_keepalive_connections=self.concurrency)
        timeout = httpx.Timeout(FETCH_TIMEOUT_SECONDS)
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }

        async with httpx.AsyncClient(
            limits=limits, timeout=timeout, headers=headers, follow_redirects=False
        ) as client:
            await self._load_discovery_files(client)

            # Restore checkpoint or start fresh
            if self._resume_pages:
                for page in self._resume_pages:
                    self._pages[page.url] = page
                    self._enqueued.add(page.url)
                for url, depth in self._resume_state.get("frontier", []):
                    self._enqueue(url, depth)
                logger.info(
                    "[SiteAudit] Resuming crawl: %s pages already captured, %s in frontier",
                    len(self._pages),
                    len(self._frontier),
                )
            if not self._pages and not self._frontier:
                self._enqueue(self.seed_url, 0)
                for sitemap_url in self.sitemap_urls[: self.page_cap]:
                    self._enqueue(sitemap_url, 1)

            semaphore = asyncio.Semaphore(self.concurrency)

            while self._frontier and len(self._pages) < self.page_cap:
                batch: List[Tuple[str, int]] = []
                while self._frontier and len(batch) < self.concurrency * 2:
                    candidate = self._frontier.pop(0)
                    if candidate[0] not in self._pages:
                        batch.append(candidate)
                if not batch:
                    continue
                batch = batch[: max(0, self.page_cap - len(self._pages))]

                results = await asyncio.gather(
                    *(self._fetch_page(client, semaphore, url, depth) for url, depth in batch)
                )
                for record in results:
                    if record is None:
                        continue
                    self._pages[record.url] = record
                    if record.is_html_ok:
                        next_depth = record.crawl_depth + 1
                        for link in record.internal_links:
                            if link["url"] not in self._enqueued:
                                self._enqueue(link["url"], next_depth)

                self._pages_since_checkpoint += len(batch)
                if self.checkpoint and self._pages_since_checkpoint >= CHECKPOINT_EVERY_PAGES:
                    self._pages_since_checkpoint = 0
                    await self._run_checkpoint()

            await self._probe_images(client)

        self._finalize_link_graph()
        context = self._build_context()
        if self.checkpoint:
            await self._run_checkpoint(final=True)
        return context

    async def _run_checkpoint(self, final: bool = False) -> None:
        state = {
            "frontier": [[url, depth] for url, depth in self._frontier[:2000]],
            "pages_crawled": len(self._pages),
            "final": final,
        }
        try:
            await self.checkpoint(state, list(self._pages.values()))
        except Exception as error:
            logger.warning("[SiteAudit] Checkpoint failed: %s", error)

    async def _fetch_page(
        self,
        client: httpx.AsyncClient,
        semaphore: asyncio.Semaphore,
        url: str,
        depth: int,
    ) -> Optional[PageRecord]:
        record = PageRecord(url=url, crawl_depth=depth)
        record.in_sitemap = url in set(self.sitemap_urls)

        if not self._robots_allows(url):
            record.blocked_by_robots = True
            return record

        async with semaphore:
            await asyncio.sleep(POLITENESS_DELAY_SECONDS)
            current_url = url
            redirect_chain: List[Dict[str, Any]] = []
            try:
                for _ in range(6):
                    response = await client.get(current_url)
                    if response.status_code in (301, 302, 303, 307, 308):
                        location = response.headers.get("location")
                        redirect_chain.append({"url": current_url, "status": response.status_code})
                        if not location:
                            break
                        next_url = normalize_url(location, current_url)
                        if not next_url or not is_safe_public_url(next_url):
                            break
                        current_url = next_url
                        continue
                    break
                else:
                    record.fetch_error = "redirect_loop"
                    record.redirect_chain = redirect_chain
                    return record

                record.status_code = response.status_code
                record.final_url = current_url if current_url != url else None
                record.redirect_chain = redirect_chain
                record.content_type = response.headers.get("content-type")
                record.response_headers = extract_security_headers(dict(response.headers))

                if record.is_html_ok and is_same_origin(current_url, self.origin):
                    parsed = parse_page(current_url, response.text, self.origin)
                    record.title = parsed["title"]
                    record.meta_description = parsed["meta_description"]
                    record.meta_robots = parsed["meta_robots"]
                    record.canonical_url = parsed["canonical_url"]
                    record.h1s = parsed["h1s"]
                    record.h2s = parsed["h2s"]
                    record.word_count = parsed["word_count"]
                    record.html_bytes = parsed["html_bytes"]
                    record.text_html_ratio = parsed["text_html_ratio"]
                    record.images = parsed["images"]
                    record.internal_links = parsed["internal_links"]
                    record.external_links = parsed["external_links"]
                    record.structured_data = parsed["structured_data"]
                    record.mixed_content = parsed["mixed_content"]
                    record.page_type = parsed["page_type"]
                    record.answer_block_signals = parsed["answer_block_signals"]

                    # Resources on this page disallowed by robots.txt
                    if self.robots_reachable:
                        blocked = []
                        for image in record.images[:50]:
                            if is_same_origin(image["src"], self.origin) and not self._robots_allows(image["src"]):
                                blocked.append(image["src"])
                        record.blocked_resources = blocked
            except httpx.HTTPError as error:
                record.fetch_error = type(error).__name__
            return record

    # ------------------------------------------------------------------
    # Image byte probing (sampled HEAD requests)
    # ------------------------------------------------------------------

    async def _probe_images(self, client: httpx.AsyncClient) -> None:
        unique: Dict[str, List[Dict[str, Any]]] = {}
        for page in self._pages.values():
            for image in page.images:
                unique.setdefault(image["src"], []).append(image)

        sources = list(unique.keys())[:IMAGE_HEAD_SAMPLE_CAP]
        semaphore = asyncio.Semaphore(self.concurrency)

        async def probe(src: str) -> None:
            async with semaphore:
                try:
                    response = await client.head(src, follow_redirects=True)
                    size = response.headers.get("content-length")
                    broken = response.status_code >= 400
                    for ref in unique[src]:
                        ref["bytes"] = int(size) if size and size.isdigit() else None
                        ref["broken"] = broken
                except httpx.HTTPError:
                    for ref in unique[src]:
                        ref["bytes"] = None
                        ref["broken"] = None  # unknown, do not flag

        await asyncio.gather(*(probe(src) for src in sources))

    # ------------------------------------------------------------------
    # Post-processing
    # ------------------------------------------------------------------

    def _finalize_link_graph(self) -> None:
        inlinks: Dict[str, int] = {}
        for page in self._pages.values():
            seen_targets: Set[str] = set()
            for link in page.internal_links:
                target = link["url"]
                if target != page.url and target not in seen_targets:
                    seen_targets.add(target)
                    inlinks[target] = inlinks.get(target, 0) + 1
        for page in self._pages.values():
            page.inlink_count = inlinks.get(page.url, 0)

    def _build_context(self) -> CrawlContext:
        blocked_urls = [p.url for p in self._pages.values() if p.blocked_by_robots]
        # Also evaluate robots against sitemap URLs we never crawled
        if self.robots_reachable:
            crawled = set(self._pages.keys())
            for url in self.sitemap_urls:
                if url not in crawled and not self._robots_allows(url):
                    blocked_urls.append(url)

        blocked_resources: List[str] = []
        for page in self._pages.values():
            blocked_resources.extend(page.blocked_resources)

        return CrawlContext(
            origin=self.origin,
            seed_url=self.seed_url,
            pages=list(self._pages.values()),
            robots_reachable=self.robots_reachable,
            robots_raw=self.robots_raw,
            robots_blocked_urls=sorted(set(blocked_urls)),
            robots_blocked_resources=sorted(set(blocked_resources)),
            sitemap_reachable=self.sitemap_reachable,
            sitemap_urls=self.sitemap_urls,
            llms_txt_reachable=self.llms_txt_reachable,
            llms_txt_preview=self.llms_txt_preview,
            parameter_urls_discovered=self.parameter_urls_discovered,
            page_cap_reached=len(self._pages) >= self.page_cap,
        )
