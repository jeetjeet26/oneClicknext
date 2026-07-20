"""
Finding persistence: fingerprinting and the discovered/fixed lifecycle.

Fingerprints are stable across crawls (detector name + optional qualifier),
so re-crawls update existing rows instead of duplicating them:

- new fingerprint      -> insert with first_detected_at = now
- persisting           -> update occurrences/evidence/last_seen_at; reopen if it was auto-fixed
- absent from re-crawl -> mark fixed_at = now, status = 'fixed' (unless wont_fix)
"""

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from supabase import Client

from siteaudit.detectors import KNOWN_DETECTOR_NAMES
from siteaudit.models import Finding

logger = logging.getLogger(__name__)

SEVERITY_TO_OWNER_DEFAULT = "web_developer"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def compute_fingerprint(finding: Finding) -> str:
    key = finding.detector
    if finding.fingerprint_qualifier:
        key = f"{key}:{finding.fingerprint_qualifier}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:24]


def sync_findings(
    supabase: Client,
    property_id: str,
    crawl_id: str,
    findings: List[Finding],
) -> Dict[str, int]:
    """
    Reconcile detector output with persisted geo_site_findings for a property.
    Returns counters: {"new": n, "updated": n, "fixed": n}
    """
    now = _utc_now_iso()
    existing_response = (
        supabase.table("geo_site_findings")
        .select("id, fingerprint, status, detector, first_detected_at, fixed_at, notes, owner")
        .eq("property_id", property_id)
        .execute()
    )
    existing_by_fingerprint = {row["fingerprint"]: row for row in (existing_response.data or [])}

    new_count = 0
    updated_count = 0
    seen_fingerprints = set()

    for finding in findings:
        fingerprint = compute_fingerprint(finding)
        seen_fingerprints.add(fingerprint)
        payload: Dict[str, Any] = {
            "property_id": property_id,
            "source_crawl_id": crawl_id,
            "fingerprint": fingerprint,
            "category": finding.category,
            "detector": finding.detector,
            "severity": finding.severity,
            "title": finding.title,
            "description": finding.description,
            "occurrences": finding.occurrences,
            "affected_urls": finding.sample_urls(),
            "affected_url_count": finding.affected_url_count,
            "evidence": finding.evidence,
            "last_seen_at": now,
            "updated_at": now,
        }

        existing = existing_by_fingerprint.get(fingerprint)
        if existing is None:
            payload["status"] = "todo"
            payload["owner"] = finding.owner or SEVERITY_TO_OWNER_DEFAULT
            payload["first_detected_at"] = now
            supabase.table("geo_site_findings").insert(payload).execute()
            new_count += 1
        else:
            # Reopen findings that were marked fixed but have reappeared.
            if existing.get("status") == "fixed":
                payload["status"] = "todo"
                payload["fixed_at"] = None
            supabase.table("geo_site_findings").update(payload).eq("id", existing["id"]).execute()
            updated_count += 1

    # Mark findings absent from this crawl as fixed (detector ran, issue gone).
    fixed_count = 0
    known = set(KNOWN_DETECTOR_NAMES)
    for fingerprint, existing in existing_by_fingerprint.items():
        if fingerprint in seen_fingerprints:
            continue
        if existing.get("status") in ("fixed", "wont_fix"):
            continue
        # Only auto-fix findings from detectors that ran in this crawl.
        if existing.get("detector") not in known:
            continue
        supabase.table("geo_site_findings").update({
            "status": "fixed",
            "fixed_at": now,
            "updated_at": now,
        }).eq("id", existing["id"]).execute()
        fixed_count += 1

    logger.info(
        "[SiteAudit] Findings sync for property %s: %s new, %s updated, %s fixed",
        property_id, new_count, updated_count, fixed_count,
    )
    return {"new": new_count, "updated": updated_count, "fixed": fixed_count}
