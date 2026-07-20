"""
Deterministic issue detectors.

Each detector takes a CrawlContext and returns zero or more Findings with
occurrence counts and affected URLs — the raw material for the audit roadmap.
"""

import logging
import re
from collections import Counter, defaultdict
from typing import Callable, Dict, List, Optional
from urllib.parse import urlparse

from siteaudit.models import CrawlContext, Finding, PageRecord

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Thresholds (aligned with common Screaming Frog / SEMrush defaults)
# ---------------------------------------------------------------------------

TITLE_MAX_CHARS = 60
TITLE_MAX_PIXELS = 561
TITLE_MIN_CHARS = 15
DESCRIPTION_MAX_CHARS = 155
DESCRIPTION_MIN_CHARS = 50
LOW_TEXT_HTML_RATIO = 0.10
THIN_PAGE_WORDS = 150
LARGE_IMAGE_BYTES = 100 * 1024
DEEP_PAGE_DEPTH = 4
SECURITY_HEADERS = {
    "x-content-type-options": "X-Content-Type-Options",
    "content-security-policy": "Content-Security-Policy",
    "strict-transport-security": "Strict-Transport-Security (HSTS)",
    "x-frame-options": "X-Frame-Options",
    "referrer-policy": "Referrer-Policy",
}

GENERIC_ANCHOR_PATTERNS = re.compile(
    r"^(?:click here|here|read more|learn more|more|view|view more|see more|details|"
    r"explore(?: this home| this| now)?|check it out|go|link|this page|continue|apply now)$",
    re.IGNORECASE,
)

VOLATILE_DESCRIPTION_PATTERN = re.compile(
    r"\$\s?\d{2,}|(?:\d+|one|two|four|six|eight)\s*(?:weeks?|months?)\s*free|"
    r"look\s*(?:and|&)\s*lease|limited\s*time|expires?|move[- ]in special|act now|ends\s+(?:soon|\d)",
    re.IGNORECASE,
)

# Approximate pixel widths for Arial 18px (Google desktop title font).
_CHAR_PIXELS: Dict[str, int] = {}
for chars, width in (
    ("iIl.,;:'|!", 5),
    ("ftr()[]{}- ", 7),
    ("\"jJ`*^", 8),
    ("abcdeghknopqsuvxyz1234567890", 10),
    ("ABCEFGHKLNPRSTUVXYZ&#$", 12),
    ("wmMWQOD@", 15),
):
    for char in chars:
        _CHAR_PIXELS[char] = width


def estimate_pixel_width(text: str) -> int:
    return sum(_CHAR_PIXELS.get(char, 10) for char in text)


def _pct_or_all(pages: List[PageRecord], affected: List[str]) -> str:
    total = len(pages)
    count = len(affected)
    if total > 0 and count == total:
        return f"all {total} crawled pages"
    return f"{count} of {total} crawled pages"


# ---------------------------------------------------------------------------
# Crawling / Indexing
# ---------------------------------------------------------------------------

def detect_robots_blocked_urls(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    if ctx.robots_blocked_urls:
        findings.append(Finding(
            category="crawling_indexing",
            detector="robots_blocked_urls",
            severity="high",
            title="Internal URLs blocked by robots.txt",
            description=(
                f"{len(ctx.robots_blocked_urls)} internal URL(s) are disallowed by robots.txt. "
                "Verify none of these are pages that should rank; blocked pages cannot be crawled or indexed "
                "by search engines or answer engines."
            ),
            occurrences=len(ctx.robots_blocked_urls),
            affected_urls=ctx.robots_blocked_urls,
            evidence={"robots_reachable": ctx.robots_reachable},
        ))
    if ctx.robots_blocked_resources:
        findings.append(Finding(
            category="crawling_indexing",
            detector="robots_blocked_resources",
            severity="medium",
            title="Internal resources blocked by robots.txt",
            description=(
                f"{len(ctx.robots_blocked_resources)} internal resource(s) (images/assets) are blocked by robots.txt. "
                "Blocked resources can prevent search engines from fully rendering pages, affecting how content "
                "and layout are evaluated. Allow required assets in robots.txt."
            ),
            occurrences=len(ctx.robots_blocked_resources),
            affected_urls=ctx.robots_blocked_resources,
        ))
    if not ctx.robots_reachable:
        findings.append(Finding(
            category="crawling_indexing",
            detector="robots_missing",
            severity="medium",
            title="robots.txt is not reachable",
            description=(
                "robots.txt did not return HTTP 200. Publish a robots.txt that allows public marketing pages "
                "and declares the sitemap location."
            ),
            occurrences=1,
            affected_urls=[f"{ctx.origin}/robots.txt"],
        ))
    return findings


def detect_broken_internal_links(ctx: CrawlContext) -> List[Finding]:
    status_by_url = {p.url: p.status_code for p in ctx.pages}
    findings: List[Finding] = []

    broken_4xx: Dict[str, List[str]] = defaultdict(list)  # broken target -> linking pages
    broken_5xx: Dict[str, List[str]] = defaultdict(list)
    for page in ctx.ok_pages():
        for link in page.internal_links:
            status = status_by_url.get(link["url"])
            if status is None:
                continue
            if 400 <= status < 500:
                broken_4xx[link["url"]].append(page.url)
            elif status >= 500:
                broken_5xx[link["url"]].append(page.url)

    if broken_4xx:
        findings.append(Finding(
            category="crawling_indexing",
            detector="internal_4xx_links",
            severity="high",
            title="Internal client error (4xx) links",
            description=(
                f"{len(broken_4xx)} internal URL(s) linked from crawled pages return a 4xx error. "
                "Broken internal links waste crawl budget and dilute link equity; fix the target or remove the link."
            ),
            occurrences=len(broken_4xx),
            affected_urls=sorted(broken_4xx.keys()),
            evidence={"linking_pages_sample": {k: v[:3] for k, v in list(broken_4xx.items())[:10]}},
        ))
    if broken_5xx:
        findings.append(Finding(
            category="crawling_indexing",
            detector="internal_5xx_links",
            severity="critical",
            title="Internal server error (5xx) links",
            description=(
                f"{len(broken_5xx)} internal URL(s) linked from crawled pages return a 5xx server error. "
                "Server errors block crawling and indexing entirely; investigate the underlying application errors."
            ),
            occurrences=len(broken_5xx),
            affected_urls=sorted(broken_5xx.keys()),
        ))
    return findings


def detect_redirect_issues(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    chained = [p for p in ctx.pages if len(p.redirect_chain) >= 2]
    loops = [p for p in ctx.pages if p.fetch_error == "redirect_loop"]
    if chained:
        findings.append(Finding(
            category="crawling_indexing",
            detector="redirect_chains",
            severity="medium",
            title="Redirect chains",
            description=(
                f"{len(chained)} URL(s) resolve through 2+ redirects. Each hop loses link equity and slows "
                "crawling; update internal links to point directly at the final URL."
            ),
            occurrences=len(chained),
            affected_urls=[p.url for p in chained],
            evidence={"chains": {p.url: p.redirect_chain for p in chained[:10]}},
        ))
    if loops:
        findings.append(Finding(
            category="crawling_indexing",
            detector="redirect_loops",
            severity="high",
            title="Redirect loops",
            description=f"{len(loops)} URL(s) never resolve to a final destination (redirect loop).",
            occurrences=len(loops),
            affected_urls=[p.url for p in loops],
        ))
    return findings


def detect_sitemap_gaps(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    if not ctx.sitemap_reachable:
        findings.append(Finding(
            category="crawling_indexing",
            detector="sitemap_missing",
            severity="high",
            title="sitemap.xml is not reachable",
            description=(
                "No reachable XML sitemap was found. A sitemap accelerates discovery of new and updated pages "
                "by search engines and answer engines."
            ),
            occurrences=1,
            affected_urls=[f"{ctx.origin}/sitemap.xml"],
        ))
        return findings

    crawled_ok = {p.url for p in ctx.ok_pages()}
    sitemap_set = set(ctx.sitemap_urls)

    orphans = sorted(u for u in crawled_ok if u not in sitemap_set)
    if orphans and len(sitemap_set) > 0:
        findings.append(Finding(
            category="crawling_indexing",
            detector="pages_missing_from_sitemap",
            severity="medium",
            title="Crawlable pages missing from sitemap.xml",
            description=(
                f"{len(orphans)} crawlable page(s) are not listed in sitemap.xml. Add them so search engines "
                "discover and refresh them reliably."
            ),
            occurrences=len(orphans),
            affected_urls=orphans,
        ))

    noindexed = [
        p for p in ctx.ok_pages()
        if p.in_sitemap and p.meta_robots and "noindex" in p.meta_robots.lower()
    ]
    if noindexed:
        findings.append(Finding(
            category="crawling_indexing",
            detector="sitemap_noindex_conflict",
            severity="high",
            title="Sitemap lists noindexed pages",
            description=(
                f"{len(noindexed)} page(s) are listed in sitemap.xml but carry a noindex robots directive — "
                "conflicting signals that waste crawl budget."
            ),
            occurrences=len(noindexed),
            affected_urls=[p.url for p in noindexed],
        ))
    return findings


# ---------------------------------------------------------------------------
# Canonicals
# ---------------------------------------------------------------------------

def detect_canonical_issues(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    pages = ctx.ok_pages()
    status_by_url = {p.url: p.status_code for p in ctx.pages}
    noindex_urls = {
        p.url for p in pages if p.meta_robots and "noindex" in p.meta_robots.lower()
    }

    missing = [p.url for p in pages if not p.canonical_url]
    relative = [
        p.url for p in pages
        if p.canonical_url and not re.match(r"^https?://", p.canonical_url, re.IGNORECASE)
    ]
    to_non_indexable: List[str] = []
    for page in pages:
        canonical = page.canonical_url
        if not canonical or not re.match(r"^https?://", canonical or "", re.IGNORECASE):
            continue
        target_status = status_by_url.get(canonical)
        if canonical in noindex_urls or (target_status is not None and target_status >= 300):
            to_non_indexable.append(page.url)

    if missing:
        findings.append(Finding(
            category="canonicals",
            detector="canonical_missing",
            severity="medium",
            title="Missing canonical tags",
            description=(
                f"{len(missing)} page(s) ({_pct_or_all(pages, missing)}) have no canonical URL. Add absolute "
                "self-referencing canonicals sitewide to consolidate ranking signals."
            ),
            occurrences=len(missing),
            affected_urls=missing,
        ))
    if relative:
        findings.append(Finding(
            category="canonicals",
            detector="canonical_relative",
            severity="medium",
            title="Relative canonical URLs",
            description=(
                f"{len(relative)} page(s) use a relative rather than absolute canonical URL, which is "
                "ambiguous for crawlers. Use full absolute URLs."
            ),
            occurrences=len(relative),
            affected_urls=relative,
        ))
    if to_non_indexable:
        findings.append(Finding(
            category="canonicals",
            detector="canonical_to_non_indexable",
            severity="high",
            title="Canonical tags point to non-indexable URLs",
            description=(
                f"{len(to_non_indexable)} page(s) declare a canonical URL that is itself non-indexable "
                "(redirects, errors, or noindex). This sends conflicting signals and can drop both pages from "
                "the index. Point canonicals at the indexable production URL."
            ),
            occurrences=len(to_non_indexable),
            affected_urls=to_non_indexable,
        ))
    return findings


# ---------------------------------------------------------------------------
# Titles
# ---------------------------------------------------------------------------

def detect_title_issues(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    pages = ctx.ok_pages()

    missing = [p.url for p in pages if not (p.title or "").strip()]
    whitespace_broken = [
        p for p in pages if p.title and re.search(r"[\n\r\t]", p.title)
    ]

    over_length: List[PageRecord] = []
    for page in pages:
        clean = re.sub(r"\s+", " ", page.title or "").strip()
        if not clean:
            continue
        if len(clean) > TITLE_MAX_CHARS or estimate_pixel_width(clean) > TITLE_MAX_PIXELS:
            over_length.append(page)

    too_short = [
        p.url for p in pages
        if (cleaned := re.sub(r"\s+", " ", p.title or "").strip()) and len(cleaned) < TITLE_MIN_CHARS
    ]

    duplicates: Dict[str, List[str]] = defaultdict(list)
    for page in pages:
        clean = re.sub(r"\s+", " ", page.title or "").strip().lower()
        if clean:
            duplicates[clean].append(page.url)
    duplicate_urls = sorted({url for urls in duplicates.values() if len(urls) > 1 for url in urls})

    if missing:
        findings.append(Finding(
            category="titles",
            detector="title_missing",
            severity="high",
            title="Missing title tags",
            description=f"{len(missing)} page(s) have no title tag — the strongest on-page relevance signal.",
            occurrences=len(missing),
            affected_urls=missing,
            owner="web_developer",
        ))
    if whitespace_broken:
        findings.append(Finding(
            category="titles",
            detector="title_embedded_whitespace",
            severity="medium",
            title="Title tags contain embedded line breaks or tabs",
            description=(
                f"{len(whitespace_broken)} page(s) render title tags with embedded line breaks or tab "
                "characters, usually from a broken title template. Google truncates or rewrites these in "
                "search results. Fix the title template."
            ),
            occurrences=len(whitespace_broken),
            affected_urls=[p.url for p in whitespace_broken],
            evidence={"samples": [repr((p.title or "")[:120]) for p in whitespace_broken[:5]]},
        ))
    if over_length:
        samples = {
            p.url: {
                "chars": len(re.sub(r"\s+", " ", p.title or "").strip()),
                "pixels": estimate_pixel_width(re.sub(r"\s+", " ", p.title or "").strip()),
            }
            for p in over_length[:10]
        }
        findings.append(Finding(
            category="titles",
            detector="title_over_length",
            severity="medium",
            title="Over-length title tags",
            description=(
                f"{len(over_length)} page(s) have titles exceeding {TITLE_MAX_CHARS} characters or "
                f"~{TITLE_MAX_PIXELS}px display width. Google truncates or rewrites these in search results; "
                "shorten while keeping the primary keyword and location first."
            ),
            occurrences=len(over_length),
            affected_urls=[p.url for p in over_length],
            evidence={"measurements": samples},
        ))
    if too_short:
        findings.append(Finding(
            category="titles",
            detector="title_too_short",
            severity="low",
            title="Very short title tags",
            description=(
                f"{len(too_short)} page(s) have titles under {TITLE_MIN_CHARS} characters, missing keyword "
                "and location context."
            ),
            occurrences=len(too_short),
            affected_urls=too_short,
        ))
    if duplicate_urls:
        groups = {title: urls for title, urls in duplicates.items() if len(urls) > 1}
        findings.append(Finding(
            category="titles",
            detector="title_duplicates",
            severity="medium",
            title="Duplicate title tags",
            description=(
                f"{len(duplicate_urls)} page(s) share a title with at least one other page across "
                f"{len(groups)} duplicate group(s). Differentiate titles so each page targets distinct intent."
            ),
            occurrences=len(duplicate_urls),
            affected_urls=duplicate_urls,
            evidence={"groups_sample": {title: urls[:5] for title, urls in list(groups.items())[:5]}},
        ))
    return findings


# ---------------------------------------------------------------------------
# Meta descriptions
# ---------------------------------------------------------------------------

def detect_description_issues(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    pages = ctx.ok_pages()

    missing = [p.url for p in pages if not (p.meta_description or "").strip()]
    over_length = [
        p for p in pages
        if p.meta_description and len(p.meta_description.strip()) > DESCRIPTION_MAX_CHARS
    ]
    volatile = [
        p for p in pages
        if p.meta_description and VOLATILE_DESCRIPTION_PATTERN.search(p.meta_description)
    ]

    duplicates: Dict[str, List[str]] = defaultdict(list)
    for page in pages:
        clean = (page.meta_description or "").strip().lower()
        if clean:
            duplicates[clean].append(page.url)
    duplicate_urls = sorted({url for urls in duplicates.values() if len(urls) > 1 for url in urls})

    if missing:
        findings.append(Finding(
            category="descriptions",
            detector="description_missing",
            severity="medium",
            title="Missing meta descriptions",
            description=(
                f"{len(missing)} page(s) have no meta description, so search engines generate their own "
                "snippet. Write unique, benefit-led descriptions under "
                f"{DESCRIPTION_MAX_CHARS} characters."
            ),
            occurrences=len(missing),
            affected_urls=missing,
            owner="content",
        ))
    if over_length:
        findings.append(Finding(
            category="descriptions",
            detector="description_over_length",
            severity="low",
            title=f"Meta descriptions over {DESCRIPTION_MAX_CHARS} characters",
            description=(
                f"{len(over_length)} page(s) have descriptions that exceed {DESCRIPTION_MAX_CHARS} characters "
                "and truncate in search results."
            ),
            occurrences=len(over_length),
            affected_urls=[p.url for p in over_length],
            evidence={"lengths": {p.url: len((p.meta_description or "").strip()) for p in over_length[:10]}},
            owner="content",
        ))
    if volatile:
        findings.append(Finding(
            category="descriptions",
            detector="description_volatile_content",
            severity="medium",
            title="Meta descriptions embed pricing or expiring promotions",
            description=(
                f"{len(volatile)} page(s) embed rent prices or time-limited promos in the meta description. "
                "When pricing or the promo changes, search snippets go stale or misleading. Replace with "
                "evergreen copy and keep offers in on-page banners."
            ),
            occurrences=len(volatile),
            affected_urls=[p.url for p in volatile],
            evidence={"samples": [(p.meta_description or "")[:160] for p in volatile[:5]]},
            owner="content",
        ))
    if duplicate_urls:
        findings.append(Finding(
            category="descriptions",
            detector="description_duplicates",
            severity="low",
            title="Duplicate meta descriptions",
            description=(
                f"{len(duplicate_urls)} page(s) share a meta description with at least one other page. "
                "Duplicate snippets suppress click-through differentiation."
            ),
            occurrences=len(duplicate_urls),
            affected_urls=duplicate_urls,
            owner="content",
        ))
    return findings


# ---------------------------------------------------------------------------
# H1s
# ---------------------------------------------------------------------------

def detect_h1_issues(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    pages = ctx.ok_pages()

    missing = [p.url for p in pages if not p.h1s]
    multiple = [p.url for p in pages if len(p.h1s) > 1]
    breadcrumb = [
        p for p in pages
        if p.h1s and (
            p.h1s[0].get("has_link")
            or re.match(r"^(?:home|communities|properties|blog|news)\s*[-–>|»]", p.h1s[0].get("text", ""), re.IGNORECASE)
        )
    ]

    duplicates: Dict[str, List[str]] = defaultdict(list)
    for page in pages:
        if page.h1s:
            key = page.h1s[0].get("text", "").strip().lower()
            if key:
                duplicates[key].append(page.url)
    duplicate_urls = sorted({url for urls in duplicates.values() if len(urls) > 1 for url in urls})

    if missing:
        findings.append(Finding(
            category="h1s",
            detector="h1_missing",
            severity="high",
            title="Missing H1 headings",
            description=(
                f"{len(missing)} page(s) ({_pct_or_all(pages, missing)}) have no H1. The H1 is the strongest "
                "on-page relevance signal after the title; add a keyword-rich H1 to every indexable page."
            ),
            occurrences=len(missing),
            affected_urls=missing,
        ))
    if multiple:
        findings.append(Finding(
            category="h1s",
            detector="h1_multiple",
            severity="low",
            title="Multiple H1 headings",
            description=(
                f"{len(multiple)} page(s) have more than one H1, diluting the primary topic signal. Keep one "
                "H1 and demote the rest to H2."
            ),
            occurrences=len(multiple),
            affected_urls=multiple,
        ))
    if breadcrumb:
        findings.append(Finding(
            category="h1s",
            detector="h1_breadcrumb",
            severity="medium",
            title="H1 contains linked breadcrumb text",
            description=(
                f"{len(breadcrumb)} page(s) render navigation/breadcrumb links inside the H1, carrying no "
                "keyword value. Replace with a descriptive, keyword-rich heading."
            ),
            occurrences=len(breadcrumb),
            affected_urls=[p.url for p in breadcrumb],
            evidence={"samples": [p.h1s[0].get("text", "")[:120] for p in breadcrumb[:5]]},
        ))
    if duplicate_urls:
        findings.append(Finding(
            category="h1s",
            detector="h1_duplicates",
            severity="low",
            title="Duplicate H1 headings across pages",
            description=(
                f"{len(duplicate_urls)} page(s) share an identical H1 with other pages. Differentiate headings "
                "so each page describes its unique content."
            ),
            occurrences=len(duplicate_urls),
            affected_urls=duplicate_urls,
        ))
    return findings


# ---------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------

def detect_content_issues(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    pages = ctx.ok_pages()
    if not pages:
        return findings

    # Duplicate template H2s: same H2 text on many pages
    h2_counter: Counter = Counter()
    h2_pages: Dict[str, List[str]] = defaultdict(list)
    for page in pages:
        for h2 in set(h2.strip().lower() for h2 in page.h2s if h2.strip()):
            h2_counter[h2] += 1
            h2_pages[h2].append(page.url)
    threshold = max(3, int(len(pages) * 0.3))
    template_h2s = {h2: count for h2, count in h2_counter.items() if count >= threshold}
    if template_h2s and len(pages) >= 5:
        affected = sorted({url for h2 in template_h2s for url in h2_pages[h2]})
        findings.append(Finding(
            category="content",
            detector="duplicate_template_h2s",
            severity="low",
            title="Duplicate template H2 headings across pages",
            description=(
                f"{len(affected)} page(s) share {len(template_h2s)} template H2 heading(s) (e.g., "
                f"{', '.join(repr(h2[:40]) for h2 in list(template_h2s)[:3])}). Differentiate template headings "
                "or demote them to styled text so headings describe unique page content."
            ),
            occurrences=len(affected),
            affected_urls=affected,
            evidence={"headings": {h2: count for h2, count in list(template_h2s.items())[:10]}},
            owner="content",
        ))

    low_ratio = [
        p for p in pages
        if p.text_html_ratio is not None and p.text_html_ratio < LOW_TEXT_HTML_RATIO and p.html_bytes > 10000
    ]
    if low_ratio:
        findings.append(Finding(
            category="content",
            detector="low_text_html_ratio",
            severity="medium",
            title="Low text-to-HTML ratio",
            description=(
                f"{len(low_ratio)} page(s) are nearly all template markup with a text-to-HTML ratio under "
                f"{int(LOW_TEXT_HTML_RATIO * 100)}%. Add substantive body copy that directly answers what "
                "prospects ask about the property."
            ),
            occurrences=len(low_ratio),
            affected_urls=[p.url for p in low_ratio],
            evidence={"ratios": {p.url: p.text_html_ratio for p in low_ratio[:10]}},
            owner="content",
        ))

    thin = [p for p in pages if p.word_count < THIN_PAGE_WORDS and p.page_type not in ("contact", "gallery", "tour")]
    if thin:
        findings.append(Finding(
            category="content",
            detector="thin_pages",
            severity="medium",
            title="Thin pages with little body copy",
            description=(
                f"{len(thin)} page(s) carry under {THIN_PAGE_WORDS} words of visible copy. Pages without "
                "substantive text give search and answer engines nothing to cite."
            ),
            occurrences=len(thin),
            affected_urls=[p.url for p in thin],
            evidence={"word_counts": {p.url: p.word_count for p in thin[:10]}},
            owner="content",
        ))
    return findings


# ---------------------------------------------------------------------------
# Links
# ---------------------------------------------------------------------------

def detect_link_issues(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    pages = ctx.ok_pages()

    generic_anchor_pages: Dict[str, int] = {}
    anchor_samples: Counter = Counter()
    for page in pages:
        count = 0
        for link in page.internal_links:
            anchor = (link.get("anchor") or "").strip()
            if anchor and GENERIC_ANCHOR_PATTERNS.match(anchor):
                count += 1
                anchor_samples[anchor.lower()] += 1
        if count > 0:
            generic_anchor_pages[page.url] = count
    if generic_anchor_pages:
        total = sum(generic_anchor_pages.values())
        findings.append(Finding(
            category="links",
            detector="non_descriptive_anchors",
            severity="medium",
            title="Non-descriptive internal anchor text",
            description=(
                f"{len(generic_anchor_pages)} page(s) use generic anchors "
                f"({', '.join(repr(a) for a, _ in anchor_samples.most_common(3))}) on {total} internal link(s). "
                "Add descriptive context to each link (address, bedroom count, page topic) so link equity "
                "passes relevance to the target pages."
            ),
            occurrences=total,
            affected_urls=sorted(generic_anchor_pages.keys()),
            evidence={"anchors": dict(anchor_samples.most_common(10))},
        ))

    single_inlink = [
        p for p in pages
        if p.inlink_count <= 1 and p.url != ctx.seed_url and p.page_type not in ("home",)
    ]
    if single_inlink and len(pages) >= 5:
        findings.append(Finding(
            category="links",
            detector="single_inlink_pages",
            severity="medium",
            title="Pages reachable through a single internal link",
            description=(
                f"{len(single_inlink)} page(s) are reachable through at most one internal link. Add "
                "cross-links (similar homes, same floor plan, related pages) and ensure they are in the XML "
                "sitemap so link equity and crawl frequency improve."
            ),
            occurrences=len(single_inlink),
            affected_urls=[p.url for p in single_inlink],
        ))

    deep = [p for p in pages if p.crawl_depth > DEEP_PAGE_DEPTH]
    if deep:
        findings.append(Finding(
            category="links",
            detector="deep_pages",
            severity="low",
            title=f"Pages deeper than {DEEP_PAGE_DEPTH} clicks from the seed",
            description=(
                f"{len(deep)} page(s) sit more than {DEEP_PAGE_DEPTH} clicks deep. Deep pages are crawled less "
                "often and accumulate less authority; surface them through hub pages or navigation."
            ),
            occurrences=len(deep),
            affected_urls=[p.url for p in deep],
        ))
    return findings


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

def detect_image_issues(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    pages = ctx.ok_pages()

    large: Dict[str, int] = {}
    missing_dims_count = 0
    missing_dims_pages: List[str] = []
    missing_alt: Dict[str, List[str]] = defaultdict(list)
    broken: Dict[str, List[str]] = defaultdict(list)

    for page in pages:
        page_missing_dims = 0
        for image in page.images:
            if image.get("bytes") and image["bytes"] > LARGE_IMAGE_BYTES:
                large[image["src"]] = image["bytes"]
            if not image.get("width") or not image.get("height"):
                page_missing_dims += 1
            if not (image.get("alt") or "").strip():
                missing_alt[image["src"]].append(page.url)
            if image.get("broken") is True:
                broken[image["src"]].append(page.url)
        if page_missing_dims:
            missing_dims_count += page_missing_dims
            missing_dims_pages.append(page.url)

    if large:
        findings.append(Finding(
            category="images",
            detector="large_images",
            severity="medium",
            title=f"Images over {LARGE_IMAGE_BYTES // 1024} kB",
            description=(
                f"{len(large)} image(s) exceed {LARGE_IMAGE_BYTES // 1024} kB. Compress and serve next-gen "
                "formats (WebP/AVIF) to improve page speed and Core Web Vitals."
            ),
            occurrences=len(large),
            affected_urls=sorted(large.keys()),
            evidence={"sizes_kb": {src: round(size / 1024) for src, size in sorted(large.items(), key=lambda kv: -kv[1])[:10]}},
        ))
    if missing_dims_count:
        findings.append(Finding(
            category="images",
            detector="images_missing_dimensions",
            severity="medium",
            title="Images missing width and height attributes",
            description=(
                f"{missing_dims_count} image element(s) lack width/height attributes, causing layout shift "
                "(CLS) as pages load. Add explicit dimensions to image templates."
            ),
            occurrences=missing_dims_count,
            affected_urls=missing_dims_pages,
        ))
    if missing_alt:
        findings.append(Finding(
            category="images",
            detector="images_missing_alt",
            severity="low",
            title="Images missing alt text",
            description=(
                f"{len(missing_alt)} image(s) have empty or missing alt attributes. Add descriptive alt text, "
                "prioritizing community and floor plan imagery."
            ),
            occurrences=len(missing_alt),
            affected_urls=sorted(missing_alt.keys()),
        ))
    if broken:
        findings.append(Finding(
            category="images",
            detector="broken_images",
            severity="medium",
            title="Broken image references",
            description=f"{len(broken)} image reference(s) return an error status. Restore or remove them.",
            occurrences=len(broken),
            affected_urls=sorted(broken.keys()),
            evidence={"referencing_pages": {src: urls[:3] for src, urls in list(broken.items())[:10]}},
        ))
    return findings


# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------

def detect_security_issues(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    pages = ctx.ok_pages()

    header_missing: Dict[str, List[str]] = defaultdict(list)
    for page in pages:
        headers = {k.lower() for k in page.response_headers.keys()}
        for header_key, header_label in SECURITY_HEADERS.items():
            if header_key not in headers:
                header_missing[header_label].append(page.url)

    fully_missing = [label for label, urls in header_missing.items() if urls]
    if fully_missing:
        affected = sorted({url for urls in header_missing.values() for url in urls})
        findings.append(Finding(
            category="security",
            detector="missing_security_headers",
            severity="medium",
            title="Missing security response headers",
            description=(
                f"{len(affected)} URL(s) are missing one or more of: {', '.join(sorted(fully_missing))}. "
                "One server-level configuration change typically resolves all of these sitewide."
            ),
            occurrences=len(affected),
            affected_urls=affected,
            evidence={"missing_by_header": {label: len(urls) for label, urls in header_missing.items()}},
        ))

    unsafe_blank: Dict[str, int] = {}
    for page in pages:
        count = 0
        for link in page.external_links:
            rel = (link.get("rel") or "").lower()
            if (link.get("target") or "").lower() == "_blank" and "noopener" not in rel:
                count += 1
        if count:
            unsafe_blank[page.url] = count
    if unsafe_blank:
        findings.append(Finding(
            category="security",
            detector="unsafe_cross_origin_links",
            severity="low",
            title="Unsafe cross-origin links",
            description=(
                f"{len(unsafe_blank)} page(s) open external links via target=\"_blank\" without rel=\"noopener\", "
                "exposing pages to reverse tabnabbing. Add rel=\"noopener noreferrer\" in the link template."
            ),
            occurrences=sum(unsafe_blank.values()),
            affected_urls=sorted(unsafe_blank.keys()),
        ))

    mixed = [p for p in pages if p.mixed_content]
    if mixed:
        findings.append(Finding(
            category="security",
            detector="mixed_content",
            severity="high",
            title="Mixed content on HTTPS pages",
            description=(
                f"{len(mixed)} HTTPS page(s) load resources over insecure HTTP. Update resource references "
                "to HTTPS."
            ),
            occurrences=sum(len(p.mixed_content) for p in mixed),
            affected_urls=[p.url for p in mixed],
            evidence={"resources_sample": {p.url: p.mixed_content[:3] for p in mixed[:5]}},
        ))
    return findings


# ---------------------------------------------------------------------------
# URL hygiene
# ---------------------------------------------------------------------------

def detect_url_issues(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    urls = [p.url for p in ctx.pages]

    non_ascii = [u for u in urls if any(ord(char) > 127 for char in u)]
    uppercase = [u for u in urls if re.search(r"[A-Z]", urlparse(u).path)]
    repetitive = []
    for u in urls:
        segments = [s for s in urlparse(u).path.split("/") if s]
        if len(segments) != len(set(segments)):
            repetitive.append(u)

    issues = []
    if non_ascii:
        issues.append(f"{len(non_ascii)} contain non-ASCII characters")
    if uppercase:
        issues.append(f"{len(uppercase)} contain uppercase")
    if repetitive:
        issues.append(f"{len(repetitive)} have repetitive path segments")

    if issues:
        affected = sorted(set(non_ascii + uppercase + repetitive))
        findings.append(Finding(
            category="urls",
            detector="url_hygiene",
            severity="low",
            title="URL hygiene: non-ASCII, uppercase, repetitive paths",
            description=(
                f"Of the crawled URLs, {', '.join(issues)}. Standardize on lowercase ASCII slugs and "
                "301-redirect legacy variants."
            ),
            occurrences=len(affected),
            affected_urls=affected,
            evidence={
                "non_ascii": len(non_ascii),
                "uppercase": len(uppercase),
                "repetitive": len(repetitive),
            },
        ))
    return findings


# ---------------------------------------------------------------------------
# GEO-specific signals
# ---------------------------------------------------------------------------

IMPORTANT_PAGE_TYPES = ["floorplans", "amenities", "neighborhood", "faq", "contact"]


def detect_geo_signals(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    pages = ctx.ok_pages()

    if not ctx.llms_txt_reachable:
        findings.append(Finding(
            category="geo_signals",
            detector="llms_txt_missing",
            severity="low",
            title="llms.txt is not published",
            description=(
                "No llms.txt file was found. Publishing /llms.txt with concise descriptions of the most "
                "important public pages helps answer engines navigate and cite the site."
            ),
            occurrences=1,
            affected_urls=[f"{ctx.origin}/llms.txt"],
        ))

    org_schema_pages = [p for p in pages if p.structured_data.get("organization")]
    if pages and not org_schema_pages:
        findings.append(Finding(
            category="geo_signals",
            detector="organization_schema_missing",
            severity="medium",
            title="No Organization/ApartmentComplex structured data detected",
            description=(
                "No crawled page carries Organization, LocalBusiness, ApartmentComplex, or RealEstateAgent "
                "JSON-LD. Add it to the homepage with name, URL, address, phone, and sameAs links so answer "
                "engines can ground the entity."
            ),
            occurrences=len(pages),
            affected_urls=[ctx.seed_url],
        ))

    faq_schema_pages = [p for p in pages if p.structured_data.get("faq")]
    if pages and not faq_schema_pages:
        findings.append(Finding(
            category="geo_signals",
            detector="faq_schema_missing",
            severity="medium",
            title="No FAQPage structured data detected",
            description=(
                "No crawled page carries FAQPage JSON-LD. Add FAQ schema matching visible Q&A content for "
                "pricing, application, amenity, pet, parking, and tour questions to improve answer extraction."
            ),
            occurrences=len(pages),
            affected_urls=[p.url for p in pages if p.page_type == "faq"] or [ctx.seed_url],
        ))

    parse_error_pages = [p for p in pages if p.structured_data.get("parse_errors", 0) > 0]
    if parse_error_pages:
        findings.append(Finding(
            category="geo_signals",
            detector="jsonld_parse_errors",
            severity="medium",
            title="JSON-LD blocks fail to parse",
            description=(
                f"{len(parse_error_pages)} page(s) contain JSON-LD that fails to parse. Broken structured "
                "data is ignored by crawlers; validate and fix the JSON."
            ),
            occurrences=sum(p.structured_data.get("parse_errors", 0) for p in parse_error_pages),
            affected_urls=[p.url for p in parse_error_pages],
        ))

    covered_types = {p.page_type for p in pages}
    if any(p.structured_data.get("faq") or p.answer_block_signals >= 3 for p in pages):
        covered_types.add("faq")
    missing_types = [t for t in IMPORTANT_PAGE_TYPES if t not in covered_types]
    if pages and missing_types:
        findings.append(Finding(
            category="geo_signals",
            detector="missing_page_types",
            severity="medium",
            title="Missing high-intent page types",
            description=(
                f"The crawl found no reachable page for: {', '.join(t.replace('_', ' ') for t in missing_types)}. "
                "Answer engines need crawlable owned pages with specific leasing, neighborhood, and FAQ evidence."
            ),
            occurrences=len(missing_types),
            affected_urls=[ctx.seed_url],
            evidence={"missing_page_types": missing_types},
            owner="content",
        ))

    answer_blocks = sum(p.answer_block_signals for p in pages)
    if pages and answer_blocks == 0:
        findings.append(Finding(
            category="geo_signals",
            detector="no_answer_blocks",
            severity="low",
            title="No answer-block content signals found",
            description=(
                "No crawled page contains question-format headings or FAQ markup. Add concise answer-first "
                "blocks (40-80 words) near the top of FAQ, pricing, amenities, and neighborhood pages so "
                "answer engines can quote them."
            ),
            occurrences=len(pages),
            affected_urls=[ctx.seed_url],
            owner="content",
        ))
    return findings


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

ALL_DETECTORS: List[Callable[[CrawlContext], List[Finding]]] = [
    detect_robots_blocked_urls,
    detect_broken_internal_links,
    detect_redirect_issues,
    detect_sitemap_gaps,
    detect_canonical_issues,
    detect_title_issues,
    detect_description_issues,
    detect_h1_issues,
    detect_content_issues,
    detect_link_issues,
    detect_image_issues,
    detect_security_issues,
    detect_url_issues,
    detect_geo_signals,
]

# Every detector name a full run can emit; used by the lifecycle sync to know
# which absent findings can be marked fixed.
KNOWN_DETECTOR_NAMES = [
    "robots_blocked_urls", "robots_blocked_resources", "robots_missing",
    "internal_4xx_links", "internal_5xx_links",
    "redirect_chains", "redirect_loops",
    "sitemap_missing", "pages_missing_from_sitemap", "sitemap_noindex_conflict",
    "canonical_missing", "canonical_relative", "canonical_to_non_indexable",
    "title_missing", "title_embedded_whitespace", "title_over_length", "title_too_short", "title_duplicates",
    "description_missing", "description_over_length", "description_volatile_content", "description_duplicates",
    "h1_missing", "h1_multiple", "h1_breadcrumb", "h1_duplicates",
    "duplicate_template_h2s", "low_text_html_ratio", "thin_pages",
    "non_descriptive_anchors", "single_inlink_pages", "deep_pages",
    "large_images", "images_missing_dimensions", "images_missing_alt", "broken_images",
    "missing_security_headers", "unsafe_cross_origin_links", "mixed_content",
    "url_hygiene",
    "llms_txt_missing", "organization_schema_missing", "faq_schema_missing",
    "jsonld_parse_errors", "missing_page_types", "no_answer_blocks",
]


def run_detectors(ctx: CrawlContext) -> List[Finding]:
    findings: List[Finding] = []
    for detector in ALL_DETECTORS:
        try:
            findings.extend(detector(ctx))
        except Exception as error:
            logger.exception("[SiteAudit] Detector %s failed: %s", detector.__name__, error)
    return findings
