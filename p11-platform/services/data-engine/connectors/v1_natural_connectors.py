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
from typing import Dict, Any, List, Tuple
from urllib.parse import urlparse

import httpx

from connectors.openai_natural_connector import OpenAINaturalConnector
from connectors.claude_natural_connector import ClaudeNaturalConnector

logger = logging.getLogger(__name__)


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
            response = await client.post(url, json=payload)
            response.raise_for_status()
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
            response.raise_for_status()
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
