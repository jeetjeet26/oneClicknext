"""
LLM analysis layer.

Takes crawl findings + GEO run signals + actual page content and writes
property-specific recommendations: per-URL proposed replacements (titles,
descriptions, H1s, answer-block copy) plus a prioritized narrative roadmap.
Every claim must be grounded in a finding ID or a tracked query signal.
Persisted to geo_recommendations (previous generations kept, marked stale).
"""

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from supabase import Client

logger = logging.getLogger(__name__)

MAX_FINDINGS_IN_PROMPT = 40
MAX_PAGES_IN_PROMPT = 30
MAX_QUERIES_IN_PROMPT = 30

ANALYST_SYSTEM_PROMPT = """You are a senior technical SEO and GEO (Generative Engine Optimization) consultant \
producing a paid, professional audit deliverable for a specific property website. You write like an experienced \
consultant addressing the property's marketing team and web developer: specific, evidence-led, and free of filler.

Hard rules:
- NEVER write generic advice. Every recommendation must reference the specific pages, findings, prompts, or \
competitors in the provided data.
- Every recommendation MUST include grounding: the finding IDs and/or tracked prompt texts it is based on.
- Proposed titles must stay under 60 characters, lead with the page topic + location, and end with the brand.
- Proposed meta descriptions must be 120-155 characters, evergreen (no prices, no expiring promotions).
- Proposed H1s must be keyword-rich, unique per page, and contain no navigation/breadcrumb text.
- Use the property's actual name, location, and page URLs from the data. Do not invent URLs or facts."""


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SiteAuditAnalyst:
    def __init__(self, supabase: Client):
        self.supabase = supabase
        self.openai_api_key = os.environ.get("OPENAI_API_KEY")
        self.anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY")
        self.openai_model = os.environ.get("SITEAUDIT_ANALYST_OPENAI_MODEL") or os.environ.get("GEO_OPENAI_MODEL") or "gpt-4o"
        self.claude_model = os.environ.get("SITEAUDIT_ANALYST_CLAUDE_MODEL") or os.environ.get("GEO_CLAUDE_MODEL") or "claude-sonnet-4-20250514"

    # ------------------------------------------------------------------
    # Context assembly
    # ------------------------------------------------------------------

    def build_context(self, property_id: str, crawl_id: str, batch_id: Optional[str]) -> Dict[str, Any]:
        property_response = (
            self.supabase.table("properties")
            .select("name, website_url, address, property_type")
            .eq("id", property_id)
            .single()
            .execute()
        )
        property_data = property_response.data or {}

        findings_response = (
            self.supabase.table("geo_site_findings")
            .select("id, category, detector, severity, title, description, occurrences, affected_urls, affected_url_count, evidence, status")
            .eq("property_id", property_id)
            .neq("status", "wont_fix")
            .is_("fixed_at", "null")
            .order("severity")
            .limit(MAX_FINDINGS_IN_PROMPT)
            .execute()
        )
        findings = findings_response.data or []

        pages_response = (
            self.supabase.table("geo_crawl_pages")
            .select("url, status_code, title, meta_description, h1s, h2s, word_count, page_type, inlink_count, crawl_depth")
            .eq("crawl_id", crawl_id)
            .eq("status_code", 200)
            .order("inlink_count", desc=True)
            .limit(MAX_PAGES_IN_PROMPT)
            .execute()
        )
        pages = pages_response.data or []

        # GEO run signals for the batch (presence/rank/SOV per query and surface)
        geo_signals: List[Dict[str, Any]] = []
        competitors: List[Dict[str, Any]] = []
        if batch_id:
            runs_response = (
                self.supabase.table("geo_runs")
                .select("id, surface, geo_scores(overall_score, visibility_pct, avg_llm_rank, avg_sov)")
                .eq("batch_id", batch_id)
                .eq("status", "completed")
                .execute()
            )
            runs = runs_response.data or []
            run_ids = [run["id"] for run in runs]
            surface_by_run = {run["id"]: run["surface"] for run in runs}
            if run_ids:
                answers_response = (
                    self.supabase.table("geo_answers")
                    .select("run_id, query_id, presence, llm_rank, sov, ordered_entities")
                    .in_("run_id", run_ids)
                    .execute()
                )
                answers = answers_response.data or []
                queries_response = (
                    self.supabase.table("geo_queries")
                    .select("id, text, type")
                    .eq("property_id", property_id)
                    .eq("is_active", True)
                    .execute()
                )
                queries = {q["id"]: q for q in (queries_response.data or [])}

                by_query: Dict[str, Dict[str, Any]] = {}
                competitor_mentions: Dict[str, List[int]] = {}
                for answer in answers:
                    query = queries.get(answer["query_id"])
                    if not query:
                        continue
                    entry = by_query.setdefault(answer["query_id"], {
                        "prompt": query["text"],
                        "type": query["type"],
                        "surfaces": {},
                    })
                    surface = surface_by_run.get(answer["run_id"], "unknown")
                    entry["surfaces"][surface] = {
                        "present": bool(answer.get("presence")),
                        "rank": answer.get("llm_rank"),
                        "sov": answer.get("sov"),
                    }
                    for entity in (answer.get("ordered_entities") or [])[:5]:
                        name = entity.get("name")
                        position = entity.get("position")
                        if name and isinstance(position, int):
                            competitor_mentions.setdefault(name, []).append(position)

                geo_signals = list(by_query.values())[:MAX_QUERIES_IN_PROMPT]
                brand = (property_data.get("name") or "").lower()
                competitors = [
                    {"name": name, "mentions": len(positions), "avg_rank": round(sum(positions) / len(positions), 1)}
                    for name, positions in sorted(competitor_mentions.items(), key=lambda kv: -len(kv[1]))
                    if name.lower() != brand
                ][:10]

        return {
            "property": {
                "name": property_data.get("name"),
                "website_url": property_data.get("website_url"),
                "address": property_data.get("address"),
                "property_type": property_data.get("property_type"),
            },
            "findings": findings,
            "pages": pages,
            "geo_signals": geo_signals,
            "competitors": competitors,
        }

    # ------------------------------------------------------------------
    # Prompt + generation
    # ------------------------------------------------------------------

    def _build_user_prompt(self, context: Dict[str, Any]) -> str:
        return f"""Produce the recommendation layer of a professional GEO/technical audit for this property.

## Property
{json.dumps(context["property"], indent=2, default=str)}

## Open technical findings (from a full-site crawl; each has an id you must cite in grounding)
{json.dumps(context["findings"], indent=2, default=str)}

## Crawled pages (current titles, descriptions, H1s — use these to write proposed replacements)
{json.dumps(context["pages"], indent=2, default=str)}

## AI visibility signals (tracked prompts and per-surface presence/rank/share-of-voice)
{json.dumps(context["geo_signals"], indent=2, default=str)}

## Competitors appearing in AI answers
{json.dumps(context["competitors"], indent=2, default=str)}

Return strict JSON with this shape:
{{
  "recommendations": [
    {{
      "type": "technical_fix" | "content_proposal" | "strategic" | "citation",
      "priority": "high" | "medium" | "low",
      "owner": "web_developer" | "content" | "seo" | "partnerships",
      "title": "specific, deliverable-style title",
      "narrative": "3-6 sentences of property-specific analysis: what is wrong, the evidence, why it matters for AI/search visibility, and what outcome fixing it produces. Reference concrete pages, numbers, and prompts.",
      "proposed_changes": [
        {{
          "url": "exact page URL from the data",
          "field": "title" | "meta_description" | "h1" | "answer_block" | "other",
          "current": "the current value from the crawl data (or null)",
          "proposed": "your specific replacement copy",
          "rationale": "1 sentence tying this to a finding or prompt"
        }}
      ],
      "grounding": {{
        "finding_ids": ["uuid", "..."],
        "query_evidence": ["exact tracked prompt text this addresses", "..."]
      }}
    }}
  ]
}}

Requirements:
- 6 to 12 recommendations, ordered by priority.
- For every page in the crawl data with a title/description/H1 finding, include concrete proposed replacement copy (batch pages of the same template into one recommendation with multiple proposed_changes entries).
- At least one recommendation must address the weakest AI visibility prompts with a specific owned-page content plan (exact H2s to add, questions to answer).
- Do not include any recommendation without grounding."""

    async def generate(self, property_id: str, crawl_id: str, batch_id: Optional[str]) -> Dict[str, Any]:
        context = self.build_context(property_id, crawl_id, batch_id)
        if not context["findings"] and not context["geo_signals"]:
            logger.info("[SiteAudit] No findings or GEO signals for property %s; skipping analyst", property_id)
            return {"success": False, "error": "no_input_data"}

        payload: Optional[Dict[str, Any]] = None
        model_used: Optional[str] = None
        prompt = self._build_user_prompt(context)

        try:
            payload = self._generate_openai(prompt)
            model_used = self.openai_model
        except Exception as error:
            logger.warning("[SiteAudit] OpenAI analyst failed (%s); trying Claude", error)
            try:
                payload = self._generate_claude(prompt)
                model_used = self.claude_model
            except Exception as claude_error:
                logger.error("[SiteAudit] Both analyst providers failed: %s", claude_error)
                return {"success": False, "error": str(claude_error)}

        recommendations = self._validate(payload, context)
        if not recommendations:
            return {"success": False, "error": "no_valid_recommendations"}

        generation_id = str(uuid.uuid4())
        now = _utc_now_iso()

        # Mark prior generations stale, keep them for history.
        self.supabase.table("geo_recommendations").update({
            "is_current": False,
            "updated_at": now,
        }).eq("property_id", property_id).eq("is_current", True).execute()

        rows = []
        for rec in recommendations:
            rows.append({
                "property_id": property_id,
                "batch_id": batch_id,
                "crawl_id": crawl_id,
                "generation_id": generation_id,
                "is_current": True,
                "type": rec["type"],
                "priority": rec["priority"],
                "owner": rec.get("owner"),
                "title": rec["title"],
                "narrative": rec["narrative"],
                "proposed_changes": rec.get("proposed_changes", []),
                "grounding": rec.get("grounding", {}),
                "status": "todo",
                "model_used": model_used,
            })
        self.supabase.table("geo_recommendations").insert(rows).execute()

        logger.info(
            "[SiteAudit] Persisted %s recommendations (generation %s) for property %s",
            len(rows), generation_id, property_id,
        )
        return {"success": True, "generation_id": generation_id, "count": len(rows), "model_used": model_used}

    # ------------------------------------------------------------------
    # Providers
    # ------------------------------------------------------------------

    def _generate_openai(self, prompt: str) -> Dict[str, Any]:
        import openai

        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY not configured")
        client = openai.OpenAI(api_key=self.openai_api_key)
        response = client.chat.completions.create(
            model=self.openai_model,
            messages=[
                {"role": "system", "content": ANALYST_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=8000,
        )
        return json.loads(response.choices[0].message.content)

    def _generate_claude(self, prompt: str) -> Dict[str, Any]:
        import anthropic

        if not self.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY not configured")
        client = anthropic.Anthropic(api_key=self.anthropic_api_key)
        response = client.messages.create(
            model=self.claude_model,
            max_tokens=8000,
            system=ANALYST_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        content = response.content[0].text
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            match = re.search(r"\{[\s\S]*\}", content)
            if match:
                return json.loads(match.group(0))
            raise ValueError("Could not parse JSON from Claude response")

    # ------------------------------------------------------------------
    # Validation: enforce grounding so nothing generic slips through
    # ------------------------------------------------------------------

    def _validate(self, payload: Optional[Dict[str, Any]], context: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not payload:
            return []
        raw = payload.get("recommendations")
        if not isinstance(raw, list):
            return []

        valid_finding_ids = {f["id"] for f in context["findings"]}
        valid_prompts = {s["prompt"] for s in context["geo_signals"]}
        valid_types = {"technical_fix", "content_proposal", "strategic", "citation"}
        valid_priorities = {"high", "medium", "low"}
        valid_owners = {"web_developer", "content", "seo", "partnerships"}

        validated: List[Dict[str, Any]] = []
        for rec in raw:
            if not isinstance(rec, dict):
                continue
            title = str(rec.get("title") or "").strip()
            narrative = str(rec.get("narrative") or "").strip()
            if not title or len(narrative) < 50:
                continue

            grounding = rec.get("grounding") or {}
            finding_ids = [fid for fid in (grounding.get("finding_ids") or []) if fid in valid_finding_ids]
            query_evidence = [q for q in (grounding.get("query_evidence") or []) if q in valid_prompts]
            if not finding_ids and not query_evidence:
                logger.warning("[SiteAudit] Dropping ungrounded recommendation: %s", title[:80])
                continue

            proposed_changes = []
            for change in rec.get("proposed_changes") or []:
                if not isinstance(change, dict):
                    continue
                if not change.get("url") or not change.get("proposed"):
                    continue
                proposed_changes.append({
                    "url": str(change["url"])[:1000],
                    "field": str(change.get("field") or "other")[:50],
                    "current": (str(change["current"])[:500] if change.get("current") is not None else None),
                    "proposed": str(change["proposed"])[:2000],
                    "rationale": str(change.get("rationale") or "")[:500],
                })

            rec_type = rec.get("type") if rec.get("type") in valid_types else "strategic"
            validated.append({
                "type": rec_type,
                "priority": rec.get("priority") if rec.get("priority") in valid_priorities else "medium",
                "owner": rec.get("owner") if rec.get("owner") in valid_owners else None,
                "title": title[:300],
                "narrative": narrative[:5000],
                "proposed_changes": proposed_changes,
                "grounding": {"finding_ids": finding_ids, "query_evidence": query_evidence},
            })
        return validated
