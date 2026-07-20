"""End-to-end crawler test against a local fixture site."""

import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import siteaudit.crawler as crawler_module  # noqa: E402
from siteaudit.crawler import SiteCrawler  # noqa: E402
from siteaudit.detectors import run_detectors  # noqa: E402

FIXTURE_PAGES = {
    "/": (
        200,
        "text/html",
        """
        <html><head>
          <title>Fixture Community | Test Homes for Rent in a Very Long Title That Exceeds Limits</title>
          <meta name="description" content="Rent from $1,999/mo. Look and Lease! 8 Weeks Free.">
        </head><body>
          <h1>Fixture Community</h1>
          <h2>Specials</h2>
          <a href="/floor-plans">Explore This Home</a>
          <a href="/gone">Old page</a>
          <a href="/blocked">Blocked page</a>
          <img src="/pic.jpg">
        </body></html>
        """,
    ),
    "/floor-plans": (
        200,
        "text/html",
        """
        <html><head><title>Floor Plans</title></head>
        <body><h2>Specials</h2><p>One bedroom homes.</p></body></html>
        """,
    ),
    "/gone": (404, "text/html", "<html><body>not found</body></html>"),
    "/blocked": (200, "text/html", "<html><body>should never be fetched</body></html>"),
    "/robots.txt": (200, "text/plain", "User-agent: *\nDisallow: /blocked\n"),
    "/sitemap.xml": (
        200,
        "application/xml",
        """<?xml version="1.0"?>
        <urlset><url><loc>{origin}/</loc></url><url><loc>{origin}/floor-plans</loc></url></urlset>
        """,
    ),
    "/pic.jpg": (200, "image/jpeg", "x" * 200000),
}


class FixtureHandler(BaseHTTPRequestHandler):
    def _serve(self, include_body: bool):
        entry = FIXTURE_PAGES.get(self.path)
        if not entry:
            self.send_response(404)
            self.end_headers()
            return
        status, content_type, body = entry
        origin = f"http://{self.headers.get('Host')}"
        payload = body.replace("{origin}", origin).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if include_body:
            self.wfile.write(payload)

    def do_GET(self):
        self._serve(include_body=True)

    def do_HEAD(self):
        self._serve(include_body=False)

    def log_message(self, *args):
        pass


@pytest.fixture()
def fixture_site():
    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


@pytest.mark.asyncio
async def test_crawl_fixture_site_end_to_end(fixture_site, monkeypatch):
    # The crawler blocks private hosts by design; allow the local fixture.
    monkeypatch.setattr(crawler_module, "is_safe_public_url", lambda url: True)

    crawler = SiteCrawler(seed_url=f"{fixture_site}/", page_cap=20, concurrency=2)
    context = await crawler.crawl()

    urls = {page.url: page for page in context.pages}
    assert f"{fixture_site}/" in urls
    assert f"{fixture_site}/floor-plans" in urls
    assert context.robots_reachable is True
    assert context.sitemap_reachable is True
    assert len(context.sitemap_urls) == 2

    # robots.txt disallow honored: /blocked never fetched, recorded as blocked
    blocked = urls[f"{fixture_site}/blocked"]
    assert blocked.blocked_by_robots is True
    assert blocked.status_code is None

    # Broken link captured
    assert urls[f"{fixture_site}/gone"].status_code == 404

    # Image byte probing via HEAD
    home = urls[f"{fixture_site}/"]
    assert home.images[0]["bytes"] == 200000

    # Detectors produce the expected findings from the fixture defects
    findings = run_detectors(context)
    detectors = {finding.detector for finding in findings}
    assert "internal_4xx_links" in detectors
    assert "robots_blocked_urls" in detectors
    assert "title_over_length" in detectors
    assert "description_volatile_content" in detectors
    assert "non_descriptive_anchors" in detectors
    assert "large_images" in detectors
    assert "images_missing_alt" in detectors
    assert "missing_security_headers" in detectors
