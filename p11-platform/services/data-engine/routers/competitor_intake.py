"""
Competitor Intake enrichment router.

Client-provided text is treated as seed/provenance only. Canonical competitor
fields are populated from online evidence such as an authoritative website or
Google Places result.
"""

import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from openai import OpenAI
from pydantic import BaseModel

from scrapers.brand_intelligence import BrandIntelligenceExtractor, SemanticSearchService
from scrapers.google_places import GooglePlacesScraper
from utils.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/competitor-intake", tags=["Competitor Intake"])


class EnrichIntakeRequest(BaseModel):
    batch_id: str
    property_id: str


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _format_embedding_for_pgvector(embedding: List[float]) -> str:
    return f"[{','.join(str(v) for v in embedding)}]"


def _parse_location(location: Optional[str]) -> Dict[str, Optional[str]]:
    if not location:
        return {"city": None, "state": None, "zip": None}

    match = re.match(
        r"^\s*(?P<city>[^,]+?)(?:,\s*(?P<state>[A-Z]{2}))?(?:\s+(?P<zip>\d{5}))?\s*$",
        location,
    )
    if not match:
        return {"city": location.strip(), "state": None, "zip": None}

    return {
        "city": (match.group("city") or "").strip() or None,
        "state": match.group("state"),
        "zip": match.group("zip"),
    }


def _find_online_evidence(candidate: Dict[str, Any]) -> Dict[str, Any]:
    seed_name = candidate.get("seed_name") or ""
    seed_location = candidate.get("seed_location") or ""
    seed_url = candidate.get("seed_url")

    if seed_url:
        return {
            "name": seed_name,
            "website_url": seed_url,
            "address": seed_location or None,
            "source": "seed_url_verified_by_scrape",
            "confidence": 0.75,
        }

    if not os.environ.get("GOOGLE_MAPS_API_KEY"):
        return {
            "source": "none",
            "error": "GOOGLE_MAPS_API_KEY is not configured for online competitor resolution",
        }

    try:
        scraper = GooglePlacesScraper()
        query = " ".join(part for part in [seed_name, seed_location, "new homes"] if part)
        results = scraper.client.places(query=query)
        places = results.get("results", [])
        if not places:
            return {"source": "google_places", "error": "No online match found"}

        best = places[0]
        place_id = best.get("place_id")
        details: Dict[str, Any] = {}
        if place_id:
            details_result = scraper.client.place(
                place_id=place_id,
                fields=["name", "formatted_address", "website", "formatted_phone_number", "geometry", "type"],
            )
            details = details_result.get("result", {})

        geometry = details.get("geometry") or best.get("geometry") or {}
        location = geometry.get("location") or {}
        address = details.get("formatted_address") or best.get("formatted_address") or best.get("vicinity")

        return {
            "name": details.get("name") or best.get("name") or seed_name,
            "website_url": details.get("website"),
            "phone": details.get("formatted_phone_number"),
            "address": address,
            "address_json": {
                **_parse_location(seed_location),
                "formatted": address,
                "lat": location.get("lat"),
                "lng": location.get("lng"),
                "place_id": place_id,
            },
            "source": "google_places",
            "confidence": 0.85 if details.get("website") else 0.65,
        }
    except Exception as exc:
        logger.warning("Google Places competitor resolution failed: %s", exc)
        return {"source": "google_places", "error": str(exc)}


def _upsert_competitor(supabase, property_id: str, candidate: Dict[str, Any], evidence: Dict[str, Any]) -> str:
    canonical_name = evidence.get("name") or candidate["seed_name"]
    normalized = _normalize_name(canonical_name)

    existing_result = supabase.table("competitors").select("*").eq("property_id", property_id).execute()
    for row in existing_result.data or []:
        if _normalize_name(row.get("name", "")) == normalized:
            update_payload = {
                "website_url": evidence.get("website_url") or row.get("website_url"),
                "address": evidence.get("address") or row.get("address"),
                "phone": evidence.get("phone") or row.get("phone"),
                "address_json": evidence.get("address_json") or row.get("address_json"),
                "is_active": True,
                "updated_at": _utc_now(),
            }
            supabase.table("competitors").update(update_payload).eq("id", row["id"]).execute()
            return row["id"]

    insert_payload = {
        "property_id": property_id,
        "name": canonical_name,
        "address": evidence.get("address"),
        "address_json": evidence.get("address_json"),
        "website_url": evidence.get("website_url"),
        "phone": evidence.get("phone"),
        "property_type": "multifamily",
        "amenities": [],
        "ils_listings": {},
        "notes": "Created by competitor intake enrichment from online evidence.",
        "is_active": True,
        "last_scraped_at": _utc_now(),
    }
    result = supabase.table("competitors").insert(insert_payload).execute()
    if not result.data:
        raise RuntimeError("Failed to create competitor from intake evidence")
    return result.data[0]["id"]


def _build_kb_content(
    competitor: Dict[str, Any],
    brand: Dict[str, Any],
    units: List[Dict[str, Any]],
    evidence: Dict[str, Any],
) -> str:
    lines = [
        f"Competitor: {competitor.get('name')}",
        f"Website: {competitor.get('website_url') or 'Unknown'}",
        f"Address: {competitor.get('address') or 'Unknown'}",
        f"Evidence source: {evidence.get('source')}",
        f"Confidence: {brand.get('confidence_score') or evidence.get('confidence') or 'Unknown'}",
    ]

    if brand.get("positioning_statement"):
        lines.append(f"Positioning: {brand['positioning_statement']}")
    if brand.get("target_audience"):
        lines.append(f"Target audience: {brand['target_audience']}")
    if brand.get("brand_voice"):
        lines.append(f"Brand voice: {brand['brand_voice']}")
    if brand.get("brand_personality"):
        lines.append(f"Brand personality: {brand['brand_personality']}")

    for label, key in [
        ("Unique selling points", "unique_selling_points"),
        ("Highlighted amenities", "highlighted_amenities"),
        ("Active specials", "active_specials"),
        ("Urgency tactics", "urgency_tactics"),
        ("Messaging themes", "key_messaging_themes"),
        ("CTA patterns", "call_to_action_patterns"),
    ]:
        values = brand.get(key) or []
        if values:
            lines.append(f"{label}: {', '.join(values)}")

    if units:
        unit_summaries = []
        for unit in units[:8]:
            rent = ""
            if unit.get("rent_min") or unit.get("rent_max"):
                rent = f", rent {unit.get('rent_min') or '?'}-{unit.get('rent_max') or '?'}"
            sqft = ""
            if unit.get("sqft_min") or unit.get("sqft_max"):
                sqft = f", {unit.get('sqft_min') or '?'}-{unit.get('sqft_max') or '?'} sq ft"
            unit_summaries.append(
                f"{unit.get('unit_type')} ({unit.get('bedrooms')} bd{sqft}{rent})"
            )
        lines.append(f"Floor plans and pricing evidence: {'; '.join(unit_summaries)}")

    return "\n".join(line for line in lines if line)


def _publish_competitor_kb(
    supabase,
    property_id: str,
    competitor_id: str,
    batch_id: str,
    candidate_id: str,
    evidence: Dict[str, Any],
) -> int:
    openai_key = os.environ.get("OPENAI_API_KEY")
    if not openai_key:
        logger.warning("OPENAI_API_KEY missing; skipping competitor KB embedding")
        return 0

    competitor_result = supabase.table("competitors").select("*").eq("id", competitor_id).single().execute()
    brand_result = (
        supabase.table("competitor_brand_intelligence")
        .select("*")
        .eq("competitor_id", competitor_id)
        .single()
        .execute()
    )
    units_result = supabase.table("competitor_units").select("*").eq("competitor_id", competitor_id).execute()

    competitor = competitor_result.data or {}
    brand = brand_result.data or {}
    units = units_result.data or []
    content = _build_kb_content(competitor, brand, units, evidence)

    openai_client = OpenAI(api_key=openai_key)
    embedding_response = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=content,
    )
    embedding = embedding_response.data[0].embedding

    supabase.table("documents").delete().eq("property_id", property_id).eq(
        "metadata->>source", "competitor_intelligence"
    ).eq("metadata->>competitor_id", competitor_id).execute()

    supabase.table("documents").insert({
        "property_id": property_id,
        "content": content,
        "embedding": _format_embedding_for_pgvector(embedding),
        "metadata": {
            "source": "competitor_intelligence",
            "source_type": "competitor_intelligence",
            "competitor_id": competitor_id,
            "intake_batch_id": batch_id,
            "intake_candidate_id": candidate_id,
            "origin": "enriched_online_evidence",
            "client_seed_used": True,
            "chatbot_prompt_injection": False,
            "evidence_source": evidence.get("source"),
            "published_at": _utc_now(),
        },
    }).execute()

    source_name = f"Competitor Intelligence: {competitor.get('name') or competitor_id}"
    existing_source = (
        supabase.table("knowledge_sources")
        .select("id")
        .eq("property_id", property_id)
        .eq("source_type", "competitor_intelligence")
        .eq("source_name", source_name)
        .execute()
    )

    source_payload = {
        "property_id": property_id,
        "source_type": "competitor_intelligence",
        "source_name": source_name,
        "source_url": competitor.get("website_url"),
        "status": "completed",
        "documents_created": 1,
        "extracted_data": {
            "competitor_id": competitor_id,
            "intake_batch_id": batch_id,
            "origin": "enriched_online_evidence",
            "chatbot_prompt_injection": False,
        },
        "processing_notes": "Generated from enriched competitor intelligence for downstream vector retrieval.",
        "last_synced_at": _utc_now(),
    }

    if existing_source.data:
        supabase.table("knowledge_sources").update(source_payload).eq(
            "id", existing_source.data[0]["id"]
        ).execute()
    else:
        supabase.table("knowledge_sources").insert(source_payload).execute()

    return 1


async def _process_candidate(supabase, property_id: str, batch_id: str, candidate: Dict[str, Any]) -> bool:
    candidate_id = candidate["id"]
    supabase.table("competitor_intake_candidates").update({
        "enrichment_status": "processing",
        "updated_at": _utc_now(),
    }).eq("id", candidate_id).execute()

    evidence = _find_online_evidence(candidate)
    if not evidence.get("website_url"):
        supabase.table("competitor_intake_candidates").update({
            "enrichment_status": "failed",
            "evidence_summary": evidence,
            "error_message": evidence.get("error") or "No authoritative website found",
            "updated_at": _utc_now(),
        }).eq("id", candidate_id).execute()
        return False

    try:
        competitor_id = _upsert_competitor(supabase, property_id, candidate, evidence)
        extractor = BrandIntelligenceExtractor()
        brand_intel, chunks, floor_plans = await extractor.extract_for_competitor(
            competitor_id=competitor_id,
            website_url=evidence["website_url"],
            competitor_name=evidence.get("name") or candidate.get("seed_name"),
            force_refresh=True,
        )

        if not brand_intel:
            raise RuntimeError("No brand intelligence extracted from online evidence")

        stored = extractor.store_brand_intelligence(brand_intel, chunks, floor_plans)
        if not stored:
            raise RuntimeError("Failed to store brand intelligence")

        search_service = SemanticSearchService()
        embedded_chunks = await search_service.generate_embeddings_for_competitor(competitor_id)
        kb_documents = _publish_competitor_kb(
            supabase=supabase,
            property_id=property_id,
            competitor_id=competitor_id,
            batch_id=batch_id,
            candidate_id=candidate_id,
            evidence=evidence,
        )

        supabase.table("competitor_intake_candidates").update({
            "competitor_id": competitor_id,
            "enrichment_status": "completed",
            "evidence_summary": {
                **evidence,
                "canonical_truth_from_online_evidence": True,
                "content_chunks": len(chunks),
                "embedded_competitor_chunks": embedded_chunks,
                "kb_documents": kb_documents,
            },
            "updated_at": _utc_now(),
        }).eq("id", candidate_id).execute()
        return True
    except Exception as exc:
        logger.exception("Competitor intake enrichment failed for candidate %s", candidate_id)
        supabase.table("competitor_intake_candidates").update({
            "enrichment_status": "failed",
            "evidence_summary": evidence,
            "error_message": str(exc),
            "updated_at": _utc_now(),
        }).eq("id", candidate_id).execute()
        return False


async def _process_batch(batch_id: str, property_id: str) -> None:
    supabase = get_supabase_client()
    supabase.table("competitor_intake_batches").update({
        "status": "processing",
        "updated_at": _utc_now(),
    }).eq("id", batch_id).eq("property_id", property_id).execute()

    candidates_result = (
        supabase.table("competitor_intake_candidates")
        .select("*")
        .eq("batch_id", batch_id)
        .eq("property_id", property_id)
        .execute()
    )
    candidates = candidates_result.data or []

    completed = 0
    failed = 0
    for candidate in candidates:
        if await _process_candidate(supabase, property_id, batch_id, candidate):
            completed += 1
        else:
            failed += 1

    final_status = "completed" if completed > 0 and failed == 0 else "failed" if completed == 0 else "completed"
    supabase.table("competitor_intake_batches").update({
        "status": final_status,
        "completed_at": _utc_now(),
        "error_message": None if completed > 0 else "No competitor candidates were enriched successfully",
        "updated_at": _utc_now(),
    }).eq("id", batch_id).eq("property_id", property_id).execute()


@router.post("/enrich")
async def enrich_competitor_intake(request: EnrichIntakeRequest, background_tasks: BackgroundTasks):
    try:
        supabase = get_supabase_client()
        batch_result = (
            supabase.table("competitor_intake_batches")
            .select("id, property_id")
            .eq("id", request.batch_id)
            .eq("property_id", request.property_id)
            .single()
            .execute()
        )
        if not batch_result.data:
            raise HTTPException(status_code=404, detail="Intake batch not found")

        background_tasks.add_task(_process_batch, request.batch_id, request.property_id)
        return {
            "success": True,
            "status": "processing",
            "batch_id": request.batch_id,
            "property_id": request.property_id,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to start competitor intake enrichment")
        raise HTTPException(status_code=500, detail=str(exc))
