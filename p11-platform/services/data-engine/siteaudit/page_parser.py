"""Per-page HTML parsing: extracts everything the detectors need."""

import json
import logging
import re
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

SECURITY_HEADERS = [
    "x-content-type-options",
    "content-security-policy",
    "strict-transport-security",
    "x-frame-options",
    "referrer-policy",
]

IGNORED_LINK_EXTENSIONS = re.compile(
    r"\.(?:avif|css|docx?|gif|ico|jpe?g|js|json|mp4|pdf|png|svg|webm|webp|xlsx?|zip)$",
    re.IGNORECASE,
)


def normalize_url(raw_href: str, base_url: str) -> Optional[str]:
    """Resolve and normalize a link; strips fragments and query strings."""
    href = (raw_href or "").strip()
    if not href or href.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
        return None
    try:
        absolute = urljoin(base_url, href)
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            return None
        cleaned = parsed._replace(fragment="", query="").geturl()
        return cleaned
    except ValueError:
        return None


def is_same_origin(url: str, origin: str) -> bool:
    try:
        a = urlparse(url)
        b = urlparse(origin)
        return (a.scheme, a.netloc) == (b.scheme, b.netloc)
    except ValueError:
        return False


def _collect_schema_types(value: Any, types: Set[str], depth: int = 0) -> None:
    if depth > 20 or value is None:
        return
    if isinstance(value, list):
        for item in value:
            _collect_schema_types(item, types, depth + 1)
        return
    if not isinstance(value, dict):
        return
    type_value = value.get("@type")
    if isinstance(type_value, str):
        types.add(type_value)
    elif isinstance(type_value, list):
        for entry in type_value:
            if isinstance(entry, str):
                types.add(entry)
    for child in value.values():
        _collect_schema_types(child, types, depth + 1)


PAGE_TYPE_PATH_RULES: List[Tuple[str, str]] = [
    (r"(?:^|/)(?:faqs?|frequently-asked-questions?)(?:/|$)", "faq"),
    (r"(?:^|/)(?:amenities?|features)(?:/|$)", "amenities"),
    (r"(?:^|/)(?:neighborhood|location|nearby|directions|community)(?:/|$)", "neighborhood"),
    (r"(?:^|/)(?:contact|contact-us)(?:/|$)", "contact"),
    (r"(?:^|/)(?:gallery|photos?|images)(?:/|$)", "gallery"),
    (r"(?:^|/)(?:pet-policy|pets?)(?:/|$)", "pet_policy"),
    (r"(?:^|/)(?:specials?|offers?)(?:/|$)", "specials"),
    (r"(?:^|/)(?:schedule-a-tour|tour|visit|virtual-tour)(?:/|$)", "tour"),
    (r"(?:^|/)(?:news|blog)(?:/|$)", "news"),
    (r"(?:^|/)(?:prequalify|pre-qualify|qualification)(?:/|$)", "prequalify"),
    (
        r"(?:^|/)(?:floorplans?|floor-plans?|plans?|apartments?|homes?|townhomes?|condos?|availability|pricing)(?:/|$)",
        "floorplans",
    ),
]


def classify_page(url: str, title: Optional[str], text: str) -> str:
    """Port of the page-type classifier from centralized-property-scrape.ts."""
    path = urlparse(url).path.lower()
    if path in ("", "/"):
        return "home"
    for pattern, page_type in PAGE_TYPE_PATH_RULES:
        if re.search(pattern, path):
            return page_type

    haystack = f"{path} {title or ''} {text[:2500]}".lower()
    content_rules: List[Tuple[str, str]] = [
        (r"floor[-_ ]?plans?|apartments?|homes?|townhomes?|condos?|availability|pricing", "floorplans"),
        (r"amenit|features", "amenities"),
        (r"neighborhood|location|nearby|directions|map|community", "neighborhood"),
        (r"faq|frequently asked|questions", "faq"),
        (r"contact|office hours|phone|email", "contact"),
        (r"gallery|photos?|images", "gallery"),
        (r"pet[-_ ]?policy|pets?|dog|cat", "pet_policy"),
        (r"specials?|concession|move[-_ ]?in|free rent|offer", "specials"),
        (r"prequalif|pre-qualif", "prequalify"),
        (r"tour|schedule|visit", "tour"),
    ]
    for pattern, page_type in content_rules:
        if re.search(pattern, haystack):
            return page_type
    return "unknown"


def extract_security_headers(headers: Dict[str, str]) -> Dict[str, str]:
    lowered = {key.lower(): value for key, value in headers.items()}
    captured = {}
    for header in SECURITY_HEADERS + ["content-type", "cache-control", "x-robots-tag"]:
        if header in lowered:
            captured[header] = lowered[header][:500]
    return captured


def parse_page(url: str, html: str, origin: str) -> Dict[str, Any]:
    """
    Parse a fetched HTML document into the fields consumed by PageRecord.
    Returns a dict so the crawler can merge fetch-level metadata.
    """
    soup = BeautifulSoup(html, "lxml")

    title_tag = soup.find("title")
    title = title_tag.get_text() if title_tag else None
    # Preserve raw whitespace so detectors can flag embedded line breaks/tabs.
    raw_title = title if title is None else title.strip("\n\r")

    meta_description = None
    meta_robots = None
    for meta in soup.find_all("meta"):
        name = (meta.get("name") or "").lower()
        if name == "description" and meta_description is None:
            meta_description = (meta.get("content") or "").strip() or None
        elif name == "robots" and meta_robots is None:
            meta_robots = (meta.get("content") or "").strip() or None

    canonical_url = None
    canonical_tag = soup.find("link", rel=lambda value: value and "canonical" in value)
    if canonical_tag:
        canonical_url = (canonical_tag.get("href") or "").strip() or None

    h1s = []
    for h1 in soup.find_all("h1"):
        text = re.sub(r"\s+", " ", h1.get_text()).strip()
        if text:
            h1s.append({"text": text[:300], "has_link": h1.find("a") is not None})

    h2s = []
    for h2 in soup.find_all("h2"):
        text = re.sub(r"\s+", " ", h2.get_text()).strip()
        if text:
            h2s.append(text[:300])

    # Structured data
    schema_types: Set[str] = set()
    parse_errors = 0
    for script in soup.find_all("script", type="application/ld+json"):
        raw = script.string or script.get_text()
        if not raw or not raw.strip():
            continue
        try:
            _collect_schema_types(json.loads(raw), schema_types)
        except (json.JSONDecodeError, RecursionError):
            parse_errors += 1

    # Links
    internal_links: List[Dict[str, Any]] = []
    external_links: List[Dict[str, Any]] = []
    for anchor in soup.find_all("a", href=True):
        normalized = normalize_url(anchor["href"], url)
        if not normalized:
            continue
        anchor_text = re.sub(r"\s+", " ", anchor.get_text()).strip()[:200]
        rel = " ".join(anchor.get("rel") or [])
        target = anchor.get("target") or ""
        entry = {"url": normalized, "anchor": anchor_text, "rel": rel, "target": target}
        if is_same_origin(normalized, origin):
            if not IGNORED_LINK_EXTENSIONS.search(urlparse(normalized).path):
                internal_links.append(entry)
        else:
            external_links.append(entry)

    # Images
    images: List[Dict[str, Any]] = []
    for img in soup.find_all("img"):
        src = normalize_url(img.get("src") or img.get("data-src") or "", url)
        if not src:
            continue
        images.append(
            {
                "src": src,
                "alt": (img.get("alt") or "").strip(),
                "has_alt_attr": img.has_attr("alt"),
                "width": img.get("width"),
                "height": img.get("height"),
                "loading": img.get("loading"),
            }
        )

    # Mixed content: http resources referenced from an https page
    mixed_content: List[str] = []
    if url.startswith("https://"):
        for tag, attr in (("img", "src"), ("script", "src"), ("link", "href"), ("iframe", "src"), ("source", "src")):
            for element in soup.find_all(tag):
                value = element.get(attr) or ""
                if value.startswith("http://"):
                    mixed_content.append(value[:500])

    # Visible text and ratios
    text_soup = BeautifulSoup(html, "lxml")
    for element in text_soup(["script", "style", "noscript", "nav", "header", "footer"]):
        element.decompose()
    text = re.sub(r"\s+", " ", text_soup.get_text(" ")).strip()
    word_count = len(text.split()) if text else 0
    html_bytes = len(html.encode("utf-8", errors="ignore"))
    text_bytes = len(text.encode("utf-8", errors="ignore"))
    text_html_ratio = round(text_bytes / html_bytes, 4) if html_bytes > 0 else None

    # Answer-block heuristics (question headings and FAQ markup)
    answer_block_signals = 0
    for heading in soup.find_all(["h2", "h3"]):
        if "?" in heading.get_text():
            answer_block_signals += 1
    answer_block_signals += len(
        soup.select('[itemtype*="FAQPage"], [class*="faq" i], [id*="faq" i], details summary')
    )

    page_type = classify_page(url, title, text)

    return {
        "title": raw_title,
        "meta_description": meta_description,
        "meta_robots": meta_robots,
        "canonical_url": canonical_url,
        "h1s": h1s,
        "h2s": h2s,
        "word_count": word_count,
        "html_bytes": html_bytes,
        "text_html_ratio": text_html_ratio,
        "images": images,
        "internal_links": internal_links,
        "external_links": external_links,
        "structured_data": {
            "types": sorted(schema_types),
            "parse_errors": parse_errors,
            "faq": "FAQPage" in schema_types,
            "organization": bool(
                schema_types & {"Organization", "ApartmentComplex", "Residence", "LocalBusiness", "RealEstateAgent"}
            ),
        },
        "mixed_content": mixed_content,
        "page_type": page_type,
        "answer_block_signals": answer_block_signals,
    }
