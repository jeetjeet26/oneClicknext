"""Shared data structures for the site audit pipeline."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Cap the number of sample URLs stored per finding; the true total is kept
# separately in affected_url_count.
AFFECTED_URL_SAMPLE_CAP = 25


@dataclass
class PageRecord:
    """Everything captured for a single URL during the crawl."""

    url: str
    final_url: Optional[str] = None
    status_code: Optional[int] = None
    redirect_chain: List[Dict[str, Any]] = field(default_factory=list)
    content_type: Optional[str] = None
    response_headers: Dict[str, str] = field(default_factory=dict)
    title: Optional[str] = None
    meta_description: Optional[str] = None
    meta_robots: Optional[str] = None
    canonical_url: Optional[str] = None
    h1s: List[Dict[str, Any]] = field(default_factory=list)  # {text, has_link}
    h2s: List[str] = field(default_factory=list)
    word_count: int = 0
    html_bytes: int = 0
    text_html_ratio: Optional[float] = None
    images: List[Dict[str, Any]] = field(default_factory=list)  # {src, alt, width, height, bytes, broken}
    internal_links: List[Dict[str, Any]] = field(default_factory=list)  # {url, anchor, rel, target}
    external_links: List[Dict[str, Any]] = field(default_factory=list)
    structured_data: Dict[str, Any] = field(default_factory=dict)  # {types, parse_errors, faq, organization}
    mixed_content: List[str] = field(default_factory=list)
    blocked_resources: List[str] = field(default_factory=list)
    page_type: str = "unknown"
    crawl_depth: int = 0
    inlink_count: int = 0
    in_sitemap: bool = False
    blocked_by_robots: bool = False
    fetch_error: Optional[str] = None
    answer_block_signals: int = 0

    @property
    def is_html_ok(self) -> bool:
        return (
            not self.blocked_by_robots
            and self.fetch_error is None
            and self.status_code is not None
            and 200 <= self.status_code < 300
            and (self.content_type or "").startswith("text/html")
        )

    def to_row(self, crawl_id: str) -> Dict[str, Any]:
        return {
            "crawl_id": crawl_id,
            "url": self.url,
            "final_url": self.final_url,
            "status_code": self.status_code,
            "redirect_chain": self.redirect_chain,
            "content_type": self.content_type,
            "response_headers": self.response_headers,
            "title": self.title,
            "meta_description": self.meta_description,
            "meta_robots": self.meta_robots,
            "canonical_url": self.canonical_url,
            "h1s": self.h1s,
            "h2s": self.h2s,
            "word_count": self.word_count,
            "html_bytes": self.html_bytes,
            "text_html_ratio": self.text_html_ratio,
            "images": self.images[:100],
            "internal_links": self.internal_links[:200],
            "external_links": self.external_links[:100],
            "structured_data": self.structured_data,
            "mixed_content": self.mixed_content[:50],
            "blocked_resources": self.blocked_resources[:50],
            "page_type": self.page_type,
            "crawl_depth": self.crawl_depth,
            "inlink_count": self.inlink_count,
            "in_sitemap": self.in_sitemap,
            "blocked_by_robots": self.blocked_by_robots,
            "fetch_error": self.fetch_error,
        }


@dataclass
class CrawlContext:
    """Aggregate crawl output consumed by the detectors."""

    origin: str
    seed_url: str
    pages: List[PageRecord]
    robots_reachable: bool = False
    robots_raw: Optional[str] = None
    robots_blocked_urls: List[str] = field(default_factory=list)
    robots_blocked_resources: List[str] = field(default_factory=list)
    sitemap_reachable: bool = False
    sitemap_urls: List[str] = field(default_factory=list)
    llms_txt_reachable: bool = False
    llms_txt_preview: Optional[str] = None
    parameter_urls_discovered: int = 0
    page_cap_reached: bool = False

    def ok_pages(self) -> List[PageRecord]:
        return [p for p in self.pages if p.is_html_ok]


@dataclass
class Finding:
    """A single occurrence-counted audit finding."""

    category: str
    detector: str
    severity: str  # critical | high | medium | low | info
    title: str
    description: str
    occurrences: int
    affected_urls: List[str] = field(default_factory=list)
    evidence: Dict[str, Any] = field(default_factory=dict)
    owner: str = "web_developer"
    # Optional stable qualifier appended to the fingerprint so one detector
    # can emit multiple independently tracked findings.
    fingerprint_qualifier: Optional[str] = None

    @property
    def affected_url_count(self) -> int:
        return len(set(self.affected_urls)) if self.affected_urls else self.occurrences

    def sample_urls(self) -> List[str]:
        seen: List[str] = []
        for url in self.affected_urls:
            if url not in seen:
                seen.append(url)
            if len(seen) >= AFFECTED_URL_SAMPLE_CAP:
                break
        return seen
