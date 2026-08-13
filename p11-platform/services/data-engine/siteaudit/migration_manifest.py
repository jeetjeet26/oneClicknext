"""Deterministic, read-only migration manifests built from SiteAudit crawls."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

from siteaudit.models import CrawlContext, PageRecord

READ_ONLY_HTTP_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class SourceMutationProhibitedError(ValueError):
    """Raised before any operation could mutate an existing source website."""


def assert_read_only_http_method(method: str) -> None:
    if method.upper() not in READ_ONLY_HTTP_METHODS:
        raise SourceMutationProhibitedError(
            f"{method.upper()} is prohibited for migration source access"
        )


def _origin(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(f"Expected an absolute HTTP URL: {value}")
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


@dataclass(frozen=True)
class ReadOnlySourceGuard:
    """Proves the source and target are isolated and source access is read-only."""

    source_url: str
    target_url: str

    def __post_init__(self) -> None:
        if _origin(self.source_url) == _origin(self.target_url):
            raise SourceMutationProhibitedError(
                "Migration source and target must have different origins"
            )

    @property
    def source_origin(self) -> str:
        return _origin(self.source_url)

    @property
    def target_origin(self) -> str:
        return _origin(self.target_url)

    def assert_request(self, method: str, url: str) -> None:
        assert_read_only_http_method(method)
        if _origin(url) != self.source_origin:
            raise SourceMutationProhibitedError(
                "Source crawler cannot cross the approved source origin"
            )

    def proof(self) -> Dict[str, Any]:
        return {
            "sourceOrigin": self.source_origin,
            "targetOrigin": self.target_origin,
            "sourceRole": "read_only",
            "targetRole": "write_target",
            "allowedSourceMethods": sorted(READ_ONLY_HTTP_METHODS),
            "sourceMutationAllowed": False,
        }


def _stable_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _evidence_secret(explicit: Optional[str]) -> bytes:
    secret = explicit or os.getenv("SITEFORGE_MIGRATION_MANIFEST_SECRET")
    if not secret or len(secret) < 32:
        raise ValueError("Migration evidence signing is not configured")
    return secret.encode("utf-8")


def _sign(value: Any, secret: bytes) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def validate_redirect_map(
    redirects: Sequence[Mapping[str, str]],
) -> List[Dict[str, str]]:
    """Return a normalized direct redirect map, rejecting loops and chains."""

    normalized: List[Dict[str, str]] = []
    destinations: Dict[str, str] = {}
    for entry in redirects:
        source = str(entry.get("from") or "").strip()
        destination = str(entry.get("to") or "").strip()
        if not source or not destination:
            raise ValueError("Redirect entries require from and to URLs")
        if source == destination:
            raise ValueError(f"Redirect loop detected at {source}")
        if source in destinations and destinations[source] != destination:
            raise ValueError(f"Conflicting redirect targets for {source}")
        destinations[source] = destination
        normalized.append({"from": source, "to": destination, "status": "301"})

    for source, destination in destinations.items():
        seen = {source}
        cursor = destination
        while cursor in destinations:
            if cursor in seen:
                raise ValueError(f"Redirect loop detected through {cursor}")
            seen.add(cursor)
            cursor = destinations[cursor]
            raise ValueError(
                f"Redirect chain detected at {source}; map directly to {cursor}"
            )
    return sorted(normalized, key=lambda entry: entry["from"])


def _target_url(target_origin: str, page: PageRecord) -> str:
    path = urlparse(page.final_url or page.url).path or "/"
    return f"{target_origin.rstrip('/')}{path}"


def _proposed_ia(pages: Iterable[PageRecord], target_origin: str) -> List[Dict[str, Any]]:
    return [
        {
            "sourceUrl": page.url,
            "targetUrl": _target_url(target_origin, page),
            "pageType": page.page_type,
            "title": page.title,
            "parentPath": "/",
        }
        for page in sorted(pages, key=lambda candidate: (candidate.crawl_depth, candidate.url))
        if page.is_html_ok
    ]


def _side_by_side_evidence(
    pages: Iterable[PageRecord],
    target_evidence: Optional[Mapping[str, Mapping[str, Any]]],
    target_origin: str,
) -> Dict[str, Any]:
    comparisons: List[Dict[str, Any]] = []
    eligible_pages = [page for page in pages if page.is_html_ok]
    for page in sorted(eligible_pages, key=lambda candidate: candidate.url):
        target_url = _target_url(target_origin, page)
        target = (target_evidence or {}).get(target_url)
        if not target:
            continue
        source_metadata = {
            "title": page.title,
            "description": page.meta_description,
            "canonicalUrl": page.canonical_url,
        }
        target_metadata = target.get("metadata") or {}
        source = {
            "url": page.url,
            "contentHash": page.provenance.get("contentHash")
            or _stable_hash(page.content),
            "metadataHash": _stable_hash(source_metadata),
            "assetCount": len(page.images),
            "formCount": len(page.forms),
        }
        normalized_target = {
            "url": target_url,
            "contentHash": str(target.get("contentHash") or ""),
            "metadataHash": str(
                target.get("metadataHash") or _stable_hash(target_metadata)
            ),
            "assetCount": int(target.get("assetCount") or 0),
            "formCount": int(target.get("formCount") or 0),
        }
        for hash_field in ("contentHash", "metadataHash"):
            hash_value = normalized_target[hash_field]
            if len(hash_value) != 64 or any(
                character not in "0123456789abcdef" for character in hash_value
            ):
                raise ValueError(
                    f"Target parity evidence requires a valid {hash_field}"
                )
        checks = {
            "content": source["contentHash"] == normalized_target["contentHash"],
            "metadata": source["metadataHash"] == normalized_target["metadataHash"],
            "assets": source["assetCount"] == normalized_target["assetCount"],
            "forms": source["formCount"] == normalized_target["formCount"],
        }
        comparisons.append(
            {
                "source": source,
                "target": normalized_target,
                "checks": checks,
                "status": "matched" if all(checks.values()) else "mismatch",
            }
        )
    complete = (
        bool(comparisons)
        and len(comparisons) == len(eligible_pages)
        and all(item["status"] == "matched" for item in comparisons)
    )
    return {
        "status": "complete" if complete else "pending",
        "algorithm": "siteforge-parity-v1",
        "checkedUrls": len(comparisons),
        "sideBySide": comparisons,
    }


def build_migration_manifest(
    context: CrawlContext,
    target_url: str,
    *,
    dns_snapshot: Optional[Mapping[str, Any]] = None,
    target_evidence: Optional[Mapping[str, Mapping[str, Any]]] = None,
    signing_secret: Optional[str] = None,
    crawl_id: Optional[str] = None,
    generated_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a complete manifest without issuing any source mutation."""

    guard = ReadOnlySourceGuard(context.seed_url, target_url)
    target_origin = guard.target_origin
    pages = sorted(context.pages, key=lambda page: page.url)
    if not pages:
        raise ValueError("Migration manifests require at least one checked URL")

    content_pages: List[Dict[str, Any]] = []
    assets: Dict[str, Dict[str, Any]] = {}
    forms: List[Dict[str, Any]] = []
    unmigrated: List[Dict[str, Any]] = []
    redirects: List[Dict[str, str]] = []
    redirect_decisions: List[Dict[str, Any]] = []

    for page in pages:
        target_page_url = _target_url(target_origin, page)
        if page.is_html_ok:
            content_pages.append(
                {
                    "url": page.url,
                    "canonicalUrl": page.canonical_url,
                    "targetUrl": target_page_url,
                    "metadata": {
                        "title": page.title,
                        "description": page.meta_description,
                        "robots": page.meta_robots,
                        **(page.content.get("metadata") or {}),
                    },
                    "schema": page.structured_data,
                    "content": {
                        **page.content,
                        "wordCount": page.word_count,
                    },
                    "provenance": page.provenance,
                }
            )
            if page.url != target_page_url:
                redirects.append({"from": page.url, "to": target_page_url})
                redirect_decisions.append(
                    {
                        "sourceUrl": page.url,
                        "decision": "redirect",
                        "targetUrl": target_page_url,
                        "reason": "Migrated source URL maps to its generated target URL.",
                    }
                )
            else:
                redirect_decisions.append(
                    {
                        "sourceUrl": page.url,
                        "decision": "preserve",
                        "targetUrl": None,
                        "reason": "The source URL is already the canonical target URL.",
                    }
                )
        else:
            unmigrated.append(
                {
                    "url": page.url,
                    "reason": (
                        "robots_blocked"
                        if page.blocked_by_robots
                        else page.fetch_error
                        or f"http_{page.status_code or 'unknown'}"
                    ),
                    "status": "requires_operator_review",
                }
            )
            redirect_decisions.append(
                {
                    "sourceUrl": page.url,
                    "decision": "exclude",
                    "targetUrl": None,
                    "reason": "The crawler could not capture migratable HTML.",
                }
            )
        for image in page.images:
            src = image.get("src")
            if src:
                assets.setdefault(
                    src,
                    {
                        **image,
                        "sourceUrl": src,
                        "discoveredOn": [],
                        "provenance": {"sourcePage": page.url, "captureMode": "read_only"},
                    },
                )
                assets[src]["discoveredOn"].append(page.url)
        for form in page.forms:
            forms.append(
                {
                    **form,
                    "sourcePage": page.url,
                    "provenance": {"captureMode": "read_only", "valuesCaptured": False},
                }
            )

    normalized_dns = dict(dns_snapshot or {})
    if normalized_dns and normalized_dns.get("captureMode") != "read_only":
        raise SourceMutationProhibitedError(
            "DNS migration evidence must be a read-only snapshot"
        )
    if not normalized_dns:
        normalized_dns = {
            "captureMode": "read_only",
            "status": "not_captured",
            "records": [],
        }

    manifest: Dict[str, Any] = {
        "sourceUrl": context.seed_url,
        "sourceReadOnly": True,
        "sourceInventory": {
            "origin": context.origin,
            "pages": [
                {
                    "url": page.url,
                    "finalUrl": page.final_url,
                    "statusCode": page.status_code,
                    "canonicalUrl": page.canonical_url,
                    "pageType": page.page_type,
                    "inSitemap": page.in_sitemap,
                }
                for page in pages
            ],
            "sitemapUrls": sorted(context.sitemap_urls),
            "proposedIA": _proposed_ia(pages, target_origin),
            "readOnlyProof": guard.proof(),
        },
        "contentManifest": {"pages": content_pages},
        "assetManifest": sorted(assets.values(), key=lambda asset: asset["sourceUrl"]),
        "formManifest": sorted(forms, key=lambda form: (form["sourcePage"], form["index"])),
        "redirectMap": validate_redirect_map(redirects),
        "redirectDecisions": sorted(
            redirect_decisions, key=lambda decision: decision["sourceUrl"]
        ),
        "unmigratedItems": unmigrated,
        "dnsSnapshot": normalized_dns,
        "parityReport": _side_by_side_evidence(pages, target_evidence, target_origin),
        "postLaunchCrawl": {
            "status": "pending",
            "requiredChecks": [
                "all_old_urls_resolve_once",
                "no_redirect_loops_or_chains",
                "canonical_targets_are_live",
                "forms_and_assets_are_reachable",
            ],
        },
    }
    manifest_hash = _stable_hash(
        {key: value for key, value in manifest.items() if key != "postLaunchCrawl"}
    )
    generated = generated_at or datetime.now(timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )
    identifier = crawl_id or f"crawl-{manifest_hash[:24]}"
    provenance = {
        "producer": "p11-data-engine/siteaudit",
        "schemaVersion": "siteforge-migration-manifest-v2",
        "crawlId": identifier,
        "generatedAt": generated,
        "checkedUrlCount": len(pages),
        "manifestHash": manifest_hash,
    }
    provenance["signature"] = _sign(
        {
            **provenance,
            "sourceUrl": context.seed_url,
        },
        _evidence_secret(signing_secret),
    )
    manifest["crawlerProvenance"] = provenance
    return manifest


def build_post_launch_crawl_evidence(
    manifest_hash: str,
    crawl_id: str,
    evidence: Sequence[Mapping[str, Any]],
    *,
    required_checks: Sequence[str],
    signing_secret: Optional[str] = None,
    verified_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Create signed, deterministic post-launch crawl evidence."""

    if not evidence:
        raise ValueError("Post-launch verification requires checked URLs")
    if not required_checks:
        raise ValueError("Post-launch verification requires deterministic checks")
    normalized = sorted(
        (dict(item) for item in evidence), key=lambda item: str(item.get("url") or "")
    )
    for item in normalized:
        checks = item.get("checks")
        if not isinstance(checks, Mapping) or any(
            check not in checks or not isinstance(checks[check], bool)
            for check in required_checks
        ):
            raise ValueError("Every checked URL must report every required check")
    failures = [
        item
        for item in normalized
        if item.get("passed") is not True
        or int(item.get("statusCode") or 0) < 200
        or int(item.get("statusCode") or 0) >= 400
        or any(item["checks"][check] is not True for check in required_checks)
    ]
    status = "passed" if not failures else "failed"
    observed_at = verified_at or datetime.now(timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )
    evidence_hash = _stable_hash(normalized)
    result: Dict[str, Any] = {
        "status": status,
        "requiredChecks": list(required_checks),
        "verifiedAt": observed_at,
        "checkedUrls": len(normalized),
        "failures": failures,
        "evidence": normalized,
        "evidenceHash": evidence_hash,
        "manifestHash": manifest_hash,
        "provenance": {
            "producer": "p11-data-engine/siteaudit",
            "schemaVersion": "siteforge-post-launch-crawl-v1",
            "crawlId": crawl_id,
        },
    }
    result["provenance"]["signature"] = _sign(
        {
            "schemaVersion": "siteforge-post-launch-crawl-v1",
            "crawlId": crawl_id,
            "verifiedAt": observed_at,
            "checkedUrls": len(normalized),
            "status": status,
            "requiredChecks": list(required_checks),
            "evidenceHash": evidence_hash,
            "failuresHash": _stable_hash(failures),
            "manifestHash": manifest_hash,
        },
        _evidence_secret(signing_secret),
    )
    return result
