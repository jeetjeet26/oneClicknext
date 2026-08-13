import json
import hashlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from siteaudit.migration_manifest import (  # noqa: E402
    ReadOnlySourceGuard,
    SourceMutationProhibitedError,
    build_migration_manifest,
    build_post_launch_crawl_evidence,
    validate_redirect_map,
)
from siteaudit.models import CrawlContext, PageRecord  # noqa: E402


FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "acacia_aurora_migration.fixture").read_text()
)
SIGNING_SECRET = "test-only-migration-manifest-secret-32-bytes"


def test_acacia_is_provably_read_only_and_aurora_is_the_only_target():
    guard = ReadOnlySourceGuard(
        FIXTURE["source"]["url"],
        FIXTURE["target"]["url"],
    )

    assert guard.proof() == {
        "sourceOrigin": "https://www.dividendhomes.com",
        "targetOrigin": "https://aurora.siteforge.example",
        "sourceRole": "read_only",
        "targetRole": "write_target",
        "allowedSourceMethods": ["GET", "HEAD", "OPTIONS"],
        "sourceMutationAllowed": False,
    }
    guard.assert_request("GET", "https://www.dividendhomes.com/floor-plans")
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        with pytest.raises(SourceMutationProhibitedError):
            guard.assert_request(method, FIXTURE["source"]["url"])


def test_source_and_target_can_never_share_the_acacia_origin():
    with pytest.raises(SourceMutationProhibitedError, match="different origins"):
        ReadOnlySourceGuard(
            "https://www.dividendhomes.com",
            "https://www.dividendhomes.com/new-site",
        )


def test_manifest_contains_complete_migration_inventory_and_evidence():
    page = PageRecord(
        url="https://www.dividendhomes.com/",
        status_code=200,
        content_type="text/html",
        title="Acacia",
        meta_description="Acacia apartment homes",
        canonical_url="https://www.dividendhomes.com/",
        page_type="home",
        word_count=3,
        images=[{"src": "https://www.dividendhomes.com/acacia.jpg", "alt": "Acacia"}],
        forms=[
            {
                "index": 0,
                "action": "https://www.dividendhomes.com/contact",
                "method": "post",
                "fields": [{"tag": "input", "type": "email", "name": "email"}],
            }
        ],
        structured_data={"types": ["ApartmentComplex"], "parse_errors": 0},
        content={"visible_text": "Acacia apartment homes", "metadata": {"og:title": "Acacia"}},
        provenance={
            "sourceUrl": "https://www.dividendhomes.com/",
            "captureMode": "read_only",
            "contentHash": "a" * 64,
        },
    )
    context = CrawlContext(
        origin="https://www.dividendhomes.com",
        seed_url="https://www.dividendhomes.com",
        pages=[page],
        sitemap_urls=[page.url],
    )

    manifest = build_migration_manifest(
        context,
        FIXTURE["target"]["url"],
        "11111111-1111-4111-8111-111111111111",
        dns_snapshot={
            "captureMode": "read_only",
            "status": "captured",
            "records": [{"type": "A", "name": "@", "value": "203.0.113.10"}],
        },
        signing_secret=SIGNING_SECRET,
        crawl_id="crawl-acacia",
        generated_at="2026-08-10T12:00:00Z",
    )

    assert manifest["propertyId"] == "11111111-1111-4111-8111-111111111111"
    assert manifest["sourceReadOnly"] is True
    assert manifest["sourceInventory"]["proposedIA"][0]["targetUrl"] == (
        "https://aurora.siteforge.example/"
    )
    assert manifest["contentManifest"]["pages"][0]["schema"]["types"] == [
        "ApartmentComplex"
    ]
    assert manifest["assetManifest"][0]["provenance"]["captureMode"] == "read_only"
    assert manifest["formManifest"][0]["provenance"]["valuesCaptured"] is False
    assert manifest["redirectMap"] == [
        {
            "from": "https://www.dividendhomes.com/",
            "to": "https://aurora.siteforge.example/",
            "status": "301",
        }
    ]
    assert manifest["parityReport"]["status"] == "pending"
    assert manifest["parityReport"]["checkedUrls"] == 0
    assert manifest["parityReport"]["sideBySide"] == []
    assert manifest["postLaunchCrawl"]["status"] == "pending"
    assert len(manifest["crawlerProvenance"]["manifestHash"]) == 64
    assert len(manifest["crawlerProvenance"]["signature"]) == 64
    assert manifest["crawlerProvenance"]["checkedUrlCount"] == 1
    assert manifest["redirectDecisions"][0]["decision"] == "redirect"


def test_manifest_requires_positive_checked_url_count():
    context = CrawlContext(
        origin="https://www.dividendhomes.com",
        seed_url="https://www.dividendhomes.com",
        pages=[],
    )
    with pytest.raises(ValueError, match="at least one checked URL"):
        build_migration_manifest(
            context,
            FIXTURE["target"]["url"],
            "11111111-1111-4111-8111-111111111111",
            signing_secret=SIGNING_SECRET,
        )


def test_post_launch_crawl_evidence_is_signed_and_requires_checked_urls():
    evidence = build_post_launch_crawl_evidence(
        "a" * 64,
        "post-launch-1",
        [
            {
                "url": "https://aurora.siteforge.example/",
                "statusCode": 200,
                "passed": True,
                "checks": {"all_old_urls_resolve_once": True},
            }
        ],
        required_checks=["all_old_urls_resolve_once"],
        signing_secret=SIGNING_SECRET,
        verified_at="2026-08-10T13:00:00Z",
    )
    assert evidence["status"] == "passed"
    assert evidence["checkedUrls"] == 1
    assert evidence["evidenceHash"] == hashlib.sha256(
        json.dumps(
            evidence["evidence"],
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
    ).hexdigest()
    assert len(evidence["provenance"]["signature"]) == 64

    with pytest.raises(ValueError, match="checked URLs"):
        build_post_launch_crawl_evidence(
            "a" * 64,
            "post-launch-empty",
            [],
            required_checks=["all_old_urls_resolve_once"],
            signing_secret=SIGNING_SECRET,
        )


@pytest.mark.parametrize(
    "redirects",
    [
        [{"from": "/a", "to": "/a"}],
        [{"from": "/a", "to": "/b"}, {"from": "/b", "to": "/a"}],
        [{"from": "/a", "to": "/b"}, {"from": "/b", "to": "/c"}],
    ],
)
def test_redirect_map_rejects_loops_and_chains(redirects):
    with pytest.raises(ValueError):
        validate_redirect_map(redirects)
