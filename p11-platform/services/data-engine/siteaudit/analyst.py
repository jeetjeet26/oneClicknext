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


def openai_completion_token_param(model: str, limit: int = 16000) -> Dict[str, int]:
    """GPT-5+ rejects max_tokens; older chat models still require it."""
    if re.search(r"^gpt-[34](?!\.)", model or "", flags=re.I):
        return {"max_tokens": limit}
    return {"max_completion_tokens": limit}


def extract_claude_text(response: Any) -> str:
    blocks = getattr(response, "content", None) or []
    parts: List[str] = []
    for block in blocks:
        if getattr(block, "type", None) and block.type != "text":
            continue
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return "\n".join(parts).strip()


def _read_pages(query):
    rows = []
    offset = 0
    while True:
        page = query.range(offset,offset+499).execute().data or []
        rows.extend(page)
        if len(page)<500: return rows
        offset += 500

class SiteAuditAnalyst:
    def __init__(self, supabase: Client):
        self.supabase = supabase
        self.openai_api_key = os.environ.get("OPENAI_API_KEY")
        self.anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY")
        self.openai_model = os.environ.get("SITEAUDIT_ANALYST_OPENAI_MODEL") or os.environ.get("GEO_OPENAI_MODEL") or "gpt-4o"
        self.claude_model = os.environ.get("SITEAUDIT_ANALYST_CLAUDE_MODEL") or os.environ.get("GEO_CLAUDE_MODEL") or "claude-sonnet-5"

    # ------------------------------------------------------------------
    # Context assembly
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Prompt + generation
    # ------------------------------------------------------------------

    def _build_user_prompt(self, context: Dict[str, Any]) -> str:
        return f"""Produce the recommendation layer of a professional GEO/technical audit for this property.

## Property
{json.dumps(context["property"], indent=2, default=str)}

## Open technical findings (from the retained crawl scope; each has an id you must cite in grounding)
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

    async def generate(self, property_id: str, crawl_id: str, batch_id: Optional[str], lease_token: Optional[str] = None) -> Dict[str, Any]:
        raise RuntimeError('Use a recorded recommendation request and retained provider receipt')

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
        valid_urls = {page.get('url') for page in context.get('pages',[]) if page.get('url')}
        for finding in context['findings']:
            valid_urls.update(url for url in (finding.get('affected_urls') or []) if isinstance(url,str))
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
            if not isinstance(grounding, dict):
                continue
            finding_ids = [fid for fid in (grounding.get("finding_ids") or []) if isinstance(fid, str) and fid in valid_finding_ids]
            query_evidence = [q for q in (grounding.get("query_evidence") or []) if isinstance(q, str) and q in valid_prompts]
            if not finding_ids and not query_evidence:
                logger.warning("[SiteAudit] Dropping ungrounded recommendation: %s", title[:80])
                continue

            pages_by_url = {page.get('url'): page for page in context.get('pages', [])}
            proposed_changes = []
            for change in rec.get("proposed_changes") or []:
                if not isinstance(change, dict):
                    continue
                if change.get("url") not in valid_urls or not change.get("proposed"):
                    continue
                field = change.get('field') if change.get('field') in ('title', 'meta_description', 'h1', 'answer_block', 'other') else 'other'
                observed = pages_by_url.get(change['url'], {})
                current = observed.get({'title': 'title', 'meta_description': 'meta_description', 'h1': 'h1s'}.get(field, ''))
                if isinstance(current, list):
                    current = '\n'.join(str(value) for value in current)
                proposed_changes.append({
                    "url": str(change["url"])[:1000],
                    "field": field,
                    "current": str(current) if current is not None else None,
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
