"""
PropertyAudit v1 natural connectors for data-engine execution.

These mirror the TypeScript v1 surfaces:
- chatgpt: OpenAI natural connector
- gemini: Gemini API natural response + delegated extraction
- perplexity: Perplexity API natural response + delegated extraction
- google_ai: Google search proxy + delegated extraction
"""
import os
import logging
import asyncio
import random
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from typing import Dict, Any, List, Tuple, Optional
from urllib.parse import urlparse

import httpx

from connectors.openai_natural_connector import OpenAINaturalConnector
from connectors.claude_natural_connector import ClaudeNaturalConnector

logger = logging.getLogger(__name__)


_gemini_throttle_lock = asyncio.Lock()
_last_gemini_request_at = 0.0


class SearchProviderRateLimitError(RuntimeError):
    """Raised when the Google search proxy provider rate-limits requests."""


def parse_non_negative_int(value: Optional[str], fallback: int) -> int:
    try:
        parsed = int(value or "")
        return parsed if parsed >= 0 else fallback
    except (TypeError, ValueError):
        return fallback


def get_retry_after_ms(response: Optional[httpx.Response]) -> Optional[int]:
    if response is None:
        return None
    retry_after = response.headers.get("retry-after")
    if not retry_after:
        return None
    try:
        seconds = float(retry_after)
        return max(0, int(seconds * 1000))
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(retry_after)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            return max(0, int((retry_at - datetime.now(timezone.utc)).total_seconds() * 1000))
        except (TypeError, ValueError):
            return None


def is_gemini_rate_limit_error(error: Exception) -> bool:
    if isinstance(error, httpx.HTTPStatusError) and error.response.status_code == 429:
        return True
    message = str(error).lower()
    return "429" in message or "too many requests" in message or "rate limit" in message


async def run_with_gemini_throttle(client: httpx.AsyncClient, url: str, payload: Dict[str, Any]) -> httpx.Response:
    global _last_gemini_request_at

    min_interval_ms = parse_non_negative_int(os.environ.get("GEO_GEMINI_THROTTLE_MS"), 1000)
    async with _gemini_throttle_lock:
        loop = asyncio.get_running_loop()
        elapsed_ms = int((loop.time() - _last_gemini_request_at) * 1000)
        if elapsed_ms < min_interval_ms:
            await asyncio.sleep((min_interval_ms - elapsed_ms) / 1000)
        _last_gemini_request_at = loop.time()
        return await client.post(url, json=payload)


async def post_gemini_with_retry(client: httpx.AsyncClient, url: str, payload: Dict[str, Any]) -> httpx.Response:
    max_retries = parse_non_negative_int(os.environ.get("GEO_GEMINI_MAX_RETRIES"), 3)
    base_backoff_ms = parse_non_negative_int(os.environ.get("GEO_GEMINI_BASE_BACKOFF_MS"), 5000)
    max_backoff_ms = parse_non_negative_int(os.environ.get("GEO_GEMINI_MAX_BACKOFF_MS"), 90000)

    last_error: Optional[Exception] = None
    for attempt in range(max_retries + 1):
        try:
            response = await run_with_gemini_throttle(client, url, payload)
            response.raise_for_status()
            return response
        except Exception as error:
            last_error = error
            if not is_gemini_rate_limit_error(error) or attempt == max_retries:
                raise

            retry_after_ms = get_retry_after_ms(getattr(error, "response", None))
            exponential_ms = min(max_backoff_ms, base_backoff_ms * (3 ** attempt))
            jitter_ms = random.randint(0, min(1000, max(1, int(exponential_ms * 0.2))))
            delay_ms = retry_after_ms if retry_after_ms is not None else min(max_backoff_ms, exponential_ms + jitter_ms)
            logger.warning(
                "[PropertyAudit] Gemini rate limited; retrying attempt %s/%s in %sms",
                attempt + 2,
                max_retries + 1,
                delay_ms,
            )
            await asyncio.sleep(delay_ms / 1000)

    raise last_error or RuntimeError("Gemini request failed")


def extract_domain(url: str) -> str:
    try:
        parsed = urlparse(url)
        return (parsed.hostname or url).replace("www.", "", 1)
    except Exception:
        return url


def choose_analyzer():
    if os.environ.get("OPENAI_API_KEY"):
        return OpenAINaturalConnector()
    return ClaudeNaturalConnector()


async def analyze_with_delegate(context: Dict[str, Any], natural_text: str):
    analyzer = choose_analyzer()
    analyzed = await analyzer.analyze_response({
        "naturalResponse": natural_text,
        "brandName": context["brandName"],
        "queryText": context["queryText"],
        "brandDomains": context.get("brandDomains", []),
        "competitors": context.get("competitors", []),
        "expectedCity": context.get("propertyLocation", {}).get("city"),
        "expectedState": context.get("propertyLocation", {}).get("state"),
    })
    return analyzed


def merge_sources_into_answer(answer_block: Dict[str, Any], search_sources: List[Dict[str, Any]]) -> Dict[str, Any]:
    citations = answer_block.get("citations", []) or []
    existing_urls = {citation.get("url") for citation in citations if citation.get("url")}
    for source in search_sources:
        url = source.get("url")
        if not url or url in existing_urls:
            continue
        citations.append({
            "url": url,
            "domain": source.get("domain") or extract_domain(url),
            "entity_ref": source.get("entity_ref") or "",
        })
        existing_urls.add(url)
    answer_block["citations"] = citations
    return answer_block


class GeminiNaturalConnector:
    def __init__(self):
        self.api_key = os.environ.get("GOOGLE_GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GOOGLE_GEMINI_API_KEY not set")
        self.model = os.environ.get("GEO_GEMINI_MODEL", "gemini-2.5-pro")
        self.enable_web_search = os.environ.get("GEO_ENABLE_WEB_SEARCH", "false").lower() == "true"

    async def get_natural_response(self, query_text: str) -> Tuple[str, List[Dict], Dict]:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent?key={self.api_key}"
        )
        payload: Dict[str, Any] = {
            "systemInstruction": {
                "parts": [{
                    "text": "You are a helpful assistant. Answer naturally in conversational prose. Do not output JSON. If unsure, say so plainly."
                }]
            },
            "contents": [{"role": "user", "parts": [{"text": query_text}]}],
            "generationConfig": {"temperature": 0, "topP": 1},
        }
        if self.enable_web_search:
            payload["tools"] = [{"googleSearchRetrieval": {}}]

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await post_gemini_with_retry(client, url, payload)
            data = response.json()

        candidate = (data.get("candidates") or [{}])[0]
        parts = candidate.get("content", {}).get("parts", [])
        text = "\n".join(part.get("text", "") for part in parts if part.get("text"))
        chunks = candidate.get("groundingMetadata", {}).get("groundingChunks", []) or []
        sources = []
        seen = set()
        for chunk in chunks:
            web = chunk.get("web") or chunk.get("retrievedContext") or {}
            uri = web.get("uri") or web.get("url")
            if not uri or uri in seen:
                continue
            seen.add(uri)
            sources.append({
                "title": web.get("title", uri),
                "url": uri,
                "domain": extract_domain(uri),
                "snippet": web.get("snippet", web.get("text", "")),
            })

        return text, sources, {"model": self.model, "raw": data, "used_web_search": bool(sources)}

    async def invoke_natural_mode(self, context: Dict[str, Any]) -> Dict[str, Any]:
        natural_text, search_sources, phase1_raw = await self.get_natural_response(context["queryText"])
        analyzed = await analyze_with_delegate(context, natural_text)
        answer_block = merge_sources_into_answer(analyzed["envelope"]["answer_block"], search_sources)
        return {
            "answer": answer_block,
            "raw": {
                "audit_mode": "natural",
                "phase1": phase1_raw,
                "phase2": analyzed["raw"],
                "natural_response": natural_text,
                "search_sources": search_sources,
                "analysis": analyzed["envelope"].get("analysis", {}),
            },
        }


class PerplexityNaturalConnector:
    def __init__(self):
        self.api_key = os.environ.get("PERPLEXITY_API_KEY")
        if not self.api_key:
            raise ValueError("PERPLEXITY_API_KEY not set")
        self.model = os.environ.get("GEO_PERPLEXITY_MODEL", "sonar-pro")

    async def get_natural_response(self, query_text: str) -> Tuple[str, List[Dict], Dict]:
        payload = {
            "model": self.model,
            "temperature": 0,
            "top_p": 1,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a helpful assistant. Answer naturally in conversational prose. Do not output JSON. If unsure, say so plainly.",
                },
                {"role": "user", "content": query_text},
            ],
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                "https://api.perplexity.ai/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
        raw_sources = []
        raw_sources.extend(data.get("citations") or [])
        raw_sources.extend(data.get("search_results") or [])

        sources = []
        seen = set()
        for source in raw_sources:
            url = source if isinstance(source, str) else source.get("url") or source.get("link")
            if not url or url in seen:
                continue
            seen.add(url)
            sources.append({
                "title": source.get("title", url) if isinstance(source, dict) else url,
                "url": url,
                "domain": extract_domain(url),
                "snippet": source.get("snippet", "") if isinstance(source, dict) else "",
            })

        return text, sources, {"model": self.model, "raw": data, "used_web_search": True}

    async def invoke_natural_mode(self, context: Dict[str, Any]) -> Dict[str, Any]:
        natural_text, search_sources, phase1_raw = await self.get_natural_response(context["queryText"])
        analyzed = await analyze_with_delegate(context, natural_text)
        answer_block = merge_sources_into_answer(analyzed["envelope"]["answer_block"], search_sources)
        return {
            "answer": answer_block,
            "raw": {
                "audit_mode": "natural",
                "phase1": phase1_raw,
                "phase2": analyzed["raw"],
                "natural_response": natural_text,
                "search_sources": search_sources,
                "analysis": analyzed["envelope"].get("analysis", {}),
            },
        }


class GoogleProxyNaturalConnector:
    def __init__(self):
        self.serpapi_key = os.environ.get("SERPAPI_API_KEY")
        self.model = os.environ.get("GEO_GOOGLE_PROXY_MODEL", "google-serp-proxy")

    async def search_google(self, query_text: str) -> List[Dict[str, Any]]:
        if not self.serpapi_key:
            raise ValueError("SERPAPI_API_KEY not set")
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                "https://serpapi.com/search.json",
                params={
                    "api_key": self.serpapi_key,
                    "engine": "google",
                    "q": query_text,
                    "gl": "us",
                    "hl": "en",
                    "num": 10,
                },
            )
            if response.status_code == 429:
                raise SearchProviderRateLimitError(
                    "Search provider rate limited Google AI Proxy requests (SerpAPI 429). "
                    "Wait before rerunning or reduce Google AI Proxy execution count."
                )
            if response.status_code >= 400:
                raise RuntimeError(f"Search provider request failed with HTTP {response.status_code}.")
            data = response.json()
        return [
            {
                "title": result.get("title", ""),
                "url": result.get("link", ""),
                "domain": extract_domain(result.get("link", "")),
                "snippet": result.get("snippet", ""),
            }
            for result in data.get("organic_results", [])
            if result.get("link")
        ]

    async def invoke_natural_mode(self, context: Dict[str, Any]) -> Dict[str, Any]:
        sources = await self.search_google(context["queryText"])
        evidence = "\n".join(
            f"{idx + 1}. {source['title']} - {source['url']}\n{source.get('snippet', '')}"
            for idx, source in enumerate(sources[:8])
        )
        natural_text = (
            f"Based on Google search results for \"{context['queryText']}\", "
            f"the most visible sources and claims are:\n{evidence}"
        )
        analyzed = await analyze_with_delegate(context, natural_text)
        answer_block = merge_sources_into_answer(analyzed["envelope"]["answer_block"], sources)
        return {
            "answer": answer_block,
            "raw": {
                "audit_mode": "natural",
                "phase1": {"model": self.model, "used_web_search": True, "search_sources": sources},
                "phase2": analyzed["raw"],
                "natural_response": natural_text,
                "search_sources": sources,
                "analysis": analyzed["envelope"].get("analysis", {}),
            },
        }
