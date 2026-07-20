"""Unit tests for the site audit page parser and issue detectors."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from siteaudit.detectors import (  # noqa: E402
    KNOWN_DETECTOR_NAMES,
    detect_canonical_issues,
    detect_content_issues,
    detect_description_issues,
    detect_h1_issues,
    detect_image_issues,
    detect_link_issues,
    detect_robots_blocked_urls,
    detect_broken_internal_links,
    detect_security_issues,
    detect_sitemap_gaps,
    detect_title_issues,
    detect_url_issues,
    detect_geo_signals,
    estimate_pixel_width,
    run_detectors,
)
from siteaudit.models import CrawlContext, PageRecord  # noqa: E402
from siteaudit.page_parser import classify_page, parse_page  # noqa: E402

ORIGIN = "https://example.com"


def make_page(url: str, **overrides) -> PageRecord:
    defaults = dict(
        status_code=200,
        content_type="text/html",
        title="A fine page title for testing",
        meta_description="A well written evergreen description that sits comfortably within limits.",
        canonical_url=url,
        h1s=[{"text": "Welcome to Example Apartments", "has_link": False}],
        h2s=["Floor Plans"],
        word_count=500,
        html_bytes=20000,
        text_html_ratio=0.25,
        response_headers={
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'self'",
            "strict-transport-security": "max-age=63072000",
            "x-frame-options": "DENY",
            "referrer-policy": "strict-origin",
        },
        inlink_count=3,
        structured_data={"types": ["Organization", "FAQPage"], "parse_errors": 0, "faq": True, "organization": True},
        answer_block_signals=2,
        page_type="home",
    )
    defaults.update(overrides)
    return PageRecord(url=url, **defaults)


def make_context(pages, **overrides) -> CrawlContext:
    defaults = dict(
        origin=ORIGIN,
        seed_url=f"{ORIGIN}/",
        pages=pages,
        robots_reachable=True,
        sitemap_reachable=True,
        sitemap_urls=[p.url for p in pages],
        llms_txt_reachable=True,
    )
    defaults.update(overrides)
    return CrawlContext(**defaults)


# ---------------------------------------------------------------------------
# Page parser
# ---------------------------------------------------------------------------

class TestParsePage:
    def test_extracts_core_fields(self):
        html = """
        <html><head>
          <title>Somerset Cove | ARK Homes</title>
          <meta name="description" content="Homes for rent in Somerset Cove.">
          <meta name="robots" content="index,follow">
          <link rel="canonical" href="https://example.com/somerset-cove/">
          <script type="application/ld+json">{"@type": "ApartmentComplex", "name": "Somerset Cove"}</script>
        </head><body>
          <h1>Somerset Cove Homes</h1>
          <h2>What are the amenities?</h2>
          <a href="/floor-plans">Explore floor plans</a>
          <a href="https://other-site.com/x" target="_blank">External</a>
          <img src="/photo.jpg" alt="Pool" width="400" height="300">
          <img src="/no-alt.jpg">
          <p>Plenty of body copy about the community and its amenities.</p>
        </body></html>
        """
        parsed = parse_page(f"{ORIGIN}/somerset-cove/", html, ORIGIN)
        assert parsed["title"] == "Somerset Cove | ARK Homes"
        assert parsed["meta_description"] == "Homes for rent in Somerset Cove."
        assert parsed["canonical_url"] == "https://example.com/somerset-cove/"
        assert parsed["h1s"][0]["text"] == "Somerset Cove Homes"
        assert parsed["h1s"][0]["has_link"] is False
        assert "ApartmentComplex" in parsed["structured_data"]["types"]
        assert parsed["structured_data"]["organization"] is True
        assert len(parsed["internal_links"]) == 1
        assert len(parsed["external_links"]) == 1
        assert len(parsed["images"]) == 2
        assert parsed["answer_block_signals"] >= 1

    def test_detects_jsonld_parse_errors_and_mixed_content(self):
        html = """
        <html><head>
          <script type="application/ld+json">{not valid json</script>
        </head><body>
          <img src="http://insecure.example.com/pic.jpg">
        </body></html>
        """
        parsed = parse_page(f"{ORIGIN}/page/", html, ORIGIN)
        assert parsed["structured_data"]["parse_errors"] == 1
        assert parsed["mixed_content"] == ["http://insecure.example.com/pic.jpg"]

    def test_classify_page(self):
        assert classify_page(f"{ORIGIN}/", None, "") == "home"
        assert classify_page(f"{ORIGIN}/faq/", None, "") == "faq"
        assert classify_page(f"{ORIGIN}/floor-plans/", None, "") == "floorplans"
        assert classify_page(f"{ORIGIN}/pet-policy/", None, "") == "pet_policy"


# ---------------------------------------------------------------------------
# Detectors
# ---------------------------------------------------------------------------

class TestTitleDetectors:
    def test_flags_embedded_whitespace_and_over_length(self):
        pages = [
            make_page(f"{ORIGIN}/a", title="Somerset Cove\n\t| ARK Homes for Rent and Lots of Extra Words That Overflow the Limit"),
            make_page(f"{ORIGIN}/b"),
        ]
        findings = detect_title_issues(make_context(pages))
        detectors = {f.detector for f in findings}
        assert "title_embedded_whitespace" in detectors
        assert "title_over_length" in detectors

    def test_flags_duplicates_with_occurrence_count(self):
        pages = [
            make_page(f"{ORIGIN}/a", title="Same Title Everywhere"),
            make_page(f"{ORIGIN}/b", title="Same Title Everywhere"),
            make_page(f"{ORIGIN}/c", title="A Unique And Different Title"),
        ]
        findings = detect_title_issues(make_context(pages))
        duplicate = next(f for f in findings if f.detector == "title_duplicates")
        assert duplicate.occurrences == 2
        assert len(duplicate.affected_urls) == 2

    def test_no_findings_on_clean_pages(self):
        pages = [make_page(f"{ORIGIN}/a"), make_page(f"{ORIGIN}/b", title="Another Good Distinct Title")]
        assert detect_title_issues(make_context(pages)) == []

    def test_pixel_width_estimation(self):
        assert estimate_pixel_width("iiii") < estimate_pixel_width("WWWW")


class TestDescriptionDetectors:
    def test_flags_volatile_pricing_and_promos(self):
        pages = [
            make_page(f"{ORIGIN}/unit-1", meta_description="Rent from $2,315/mo. Look and Lease! 8 Weeks Free."),
            make_page(f"{ORIGIN}/unit-2", meta_description="x" * 200),
            make_page(f"{ORIGIN}/unit-3", meta_description=None),
        ]
        findings = detect_description_issues(make_context(pages))
        detectors = {f.detector for f in findings}
        assert "description_volatile_content" in detectors
        assert "description_over_length" in detectors
        assert "description_missing" in detectors


class TestH1Detectors:
    def test_flags_missing_and_breadcrumb_h1s(self):
        pages = [
            make_page(f"{ORIGIN}/unit-1", h1s=[]),
            make_page(f"{ORIGIN}/community", h1s=[{"text": "Communities - Somerset Cove", "has_link": True}]),
        ]
        findings = detect_h1_issues(make_context(pages))
        detectors = {f.detector for f in findings}
        assert "h1_missing" in detectors
        assert "h1_breadcrumb" in detectors


class TestCanonicalDetectors:
    def test_flags_missing_relative_and_non_indexable(self):
        redirecting = make_page(f"{ORIGIN}/old", status_code=301)
        pages = [
            make_page(f"{ORIGIN}/a", canonical_url=None),
            make_page(f"{ORIGIN}/b", canonical_url="/relative-canonical"),
            make_page(f"{ORIGIN}/c", canonical_url=f"{ORIGIN}/old"),
            redirecting,
        ]
        findings = detect_canonical_issues(make_context(pages))
        detectors = {f.detector for f in findings}
        assert "canonical_missing" in detectors
        assert "canonical_relative" in detectors
        assert "canonical_to_non_indexable" in detectors


class TestCrawlIndexDetectors:
    def test_robots_blocked_urls(self):
        ctx = make_context([make_page(f"{ORIGIN}/a")], robots_blocked_urls=[f"{ORIGIN}/blocked-{i}" for i in range(514)])
        findings = detect_robots_blocked_urls(ctx)
        blocked = next(f for f in findings if f.detector == "robots_blocked_urls")
        assert blocked.occurrences == 514
        assert len(blocked.sample_urls()) <= 25
        assert blocked.affected_url_count == 514

    def test_broken_internal_links(self):
        target = make_page(f"{ORIGIN}/gone", status_code=404)
        linker = make_page(f"{ORIGIN}/a", internal_links=[{"url": f"{ORIGIN}/gone", "anchor": "old page", "rel": "", "target": ""}])
        findings = detect_broken_internal_links(make_context([linker, target]))
        broken = next(f for f in findings if f.detector == "internal_4xx_links")
        assert broken.occurrences == 1
        assert f"{ORIGIN}/gone" in broken.affected_urls

    def test_sitemap_gaps(self):
        page_not_in_sitemap = make_page(f"{ORIGIN}/orphan", in_sitemap=False)
        ctx = make_context([page_not_in_sitemap], sitemap_urls=[f"{ORIGIN}/other"])
        findings = detect_sitemap_gaps(ctx)
        assert any(f.detector == "pages_missing_from_sitemap" for f in findings)


class TestContentDetectors:
    def test_flags_template_h2s_low_ratio_and_thin_pages(self):
        pages = [
            make_page(
                f"{ORIGIN}/unit-{i}",
                h2s=["Specials", "All Photos"],
                text_html_ratio=0.03,
                word_count=20,
                page_type="floorplans",
            )
            for i in range(6)
        ]
        findings = detect_content_issues(make_context(pages))
        detectors = {f.detector for f in findings}
        assert "duplicate_template_h2s" in detectors
        assert "low_text_html_ratio" in detectors
        assert "thin_pages" in detectors


class TestLinkDetectors:
    def test_flags_generic_anchors_and_single_inlink(self):
        pages = [
            make_page(
                f"{ORIGIN}/community",
                internal_links=[
                    {"url": f"{ORIGIN}/unit-{i}", "anchor": "Explore This Home", "rel": "", "target": ""}
                    for i in range(24)
                ],
            ),
        ] + [make_page(f"{ORIGIN}/unit-{i}", inlink_count=1, page_type="floorplans") for i in range(5)]
        findings = detect_link_issues(make_context(pages))
        anchors = next(f for f in findings if f.detector == "non_descriptive_anchors")
        assert anchors.occurrences == 24
        assert any(f.detector == "single_inlink_pages" for f in findings)


class TestImageDetectors:
    def test_flags_large_missing_dims_alt_and_broken(self):
        pages = [
            make_page(
                f"{ORIGIN}/gallery",
                images=[
                    {"src": f"{ORIGIN}/big.jpg", "alt": "big", "width": "10", "height": "10", "bytes": 250000, "broken": False},
                    {"src": f"{ORIGIN}/nodims.jpg", "alt": "x", "width": None, "height": None, "bytes": 1000, "broken": False},
                    {"src": f"{ORIGIN}/noalt.jpg", "alt": "", "width": "10", "height": "10", "bytes": 1000, "broken": False},
                    {"src": f"{ORIGIN}/broken.jpg", "alt": "b", "width": "10", "height": "10", "bytes": None, "broken": True},
                ],
            ),
        ]
        findings = detect_image_issues(make_context(pages))
        detectors = {f.detector for f in findings}
        assert detectors == {"large_images", "images_missing_dimensions", "images_missing_alt", "broken_images"}


class TestSecurityDetectors:
    def test_flags_missing_headers_unsafe_links_mixed_content(self):
        pages = [
            make_page(
                f"{ORIGIN}/a",
                response_headers={},
                external_links=[{"url": "https://x.com", "anchor": "x", "rel": "", "target": "_blank"}],
                mixed_content=["http://insecure.example.com/x.js"],
            ),
        ]
        findings = detect_security_issues(make_context(pages))
        detectors = {f.detector for f in findings}
        assert detectors == {"missing_security_headers", "unsafe_cross_origin_links", "mixed_content"}


class TestUrlDetectors:
    def test_flags_url_hygiene(self):
        pages = [
            make_page(f"{ORIGIN}/UPPER/Case"),
            make_page(f"{ORIGIN}/caf\u00e9"),
            make_page(f"{ORIGIN}/homes/homes/unit"),
            make_page(f"{ORIGIN}/clean-url"),
        ]
        findings = detect_url_issues(make_context(pages))
        hygiene = next(f for f in findings if f.detector == "url_hygiene")
        assert hygiene.evidence["uppercase"] == 1
        assert hygiene.evidence["non_ascii"] == 1
        assert hygiene.evidence["repetitive"] == 1


class TestGeoSignalDetectors:
    def test_flags_missing_llms_schema_and_page_types(self):
        pages = [
            make_page(
                f"{ORIGIN}/",
                structured_data={"types": [], "parse_errors": 1, "faq": False, "organization": False},
                answer_block_signals=0,
                page_type="home",
            ),
        ]
        ctx = make_context(pages, llms_txt_reachable=False)
        findings = detect_geo_signals(ctx)
        detectors = {f.detector for f in findings}
        assert "llms_txt_missing" in detectors
        assert "organization_schema_missing" in detectors
        assert "faq_schema_missing" in detectors
        assert "jsonld_parse_errors" in detectors
        assert "missing_page_types" in detectors
        assert "no_answer_blocks" in detectors


class TestRegistry:
    def test_run_detectors_returns_only_known_detector_names(self):
        pages = [
            make_page(f"{ORIGIN}/a", title=None, meta_description=None, h1s=[], canonical_url=None),
        ]
        findings = run_detectors(make_context(pages, llms_txt_reachable=False))
        assert findings, "expected findings on a defective page"
        for finding in findings:
            assert finding.detector in KNOWN_DETECTOR_NAMES
