"""
Claude Natural Connector (Two-Phase GEO)
Phase 1: Get natural conversational response (like real Claude)
Phase 2: Analyze that response to extract GEO metrics
"""
import os
import logging
import re
from typing import Any, Dict, List, Optional, Tuple
import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


def extract_domain(url: str) -> str:
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        return (parsed.hostname or url).replace('www.', '', 1)
    except Exception:
        return url


def _block_value(block: Any, key: str, default: Any = None) -> Any:
    if isinstance(block, dict):
        return block.get(key, default)
    return getattr(block, key, default)


def extract_sources_from_claude_response(response: Any) -> List[Dict[str, str]]:
    """Pull citation URLs from Anthropic web_search content and text citations."""
    sources: List[Dict[str, str]] = []
    seen = set()

    def add_source(url: Optional[str], title: str = '', snippet: str = '') -> None:
        if not url or url in seen:
            return
        seen.add(url)
        sources.append({
            'title': title or '',
            'url': url,
            'domain': extract_domain(url),
            'snippet': snippet or '',
        })

    for block in _block_value(response, 'content', []) or []:
        for citation in _block_value(block, 'citations', []) or []:
            add_source(
                _block_value(citation, 'url'),
                _block_value(citation, 'title', '') or '',
                _block_value(citation, 'cited_text', '') or '',
            )

        if _block_value(block, 'type') != 'web_search_tool_result':
            continue
        content = _block_value(block, 'content', []) or []
        if isinstance(content, list):
            for item in content:
                add_source(
                    _block_value(item, 'url'),
                    _block_value(item, 'title', '') or '',
                    _block_value(item, 'snippet', '') or '',
                )

    return sources


class ClaudeNaturalConnector:
    """Two-phase natural mode connector for Claude."""
    
    def __init__(self):
        self.api_key = os.environ.get('ANTHROPIC_API_KEY')
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY not set")
        
        self.client = anthropic.Anthropic(api_key=self.api_key)
        self.model = os.environ.get('GEO_CLAUDE_MODEL', 'claude-sonnet-5')
        claude_search = os.environ.get('GEO_CLAUDE_WEB_SEARCH')
        if claude_search is not None:
            self.enable_web_search = claude_search.lower() == 'true'
        else:
            self.enable_web_search = os.environ.get('GEO_ENABLE_WEB_SEARCH', 'true').lower() == 'true'
        
        logger.info(f"[ClaudeNatural] Model: {self.model}, Web search: {self.enable_web_search}")
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
    async def get_natural_response(self, query_text: str) -> Tuple[str, List[Dict], Dict]:
        """
        Phase 1: Get natural conversational response with web search.
        NO property context - simulates real user Claude experience.
        
        Returns:
            (response_text, search_sources, raw_response)
        """
        logger.info(f"[Claude-Natural] Phase 1: Getting natural response for: {query_text[:50]}...")
        
        system_prompt = 'You are a helpful assistant. Answer naturally in conversational prose. Do not output JSON. If unsure, say so plainly.'
        search_sources: List[Dict[str, str]] = []

        def collect_text(response: Any) -> str:
            return '\n'.join(
                _block_value(block, 'text', '') or ''
                for block in _block_value(response, 'content', []) or []
                if _block_value(block, 'type') == 'text'
            ).strip()

        if self.enable_web_search:
            try:
                logger.info("[Claude-Natural] Using Anthropic web_search_20250305")
                response = self.client.messages.create(
                    model=self.model,
                    max_tokens=2000,
                    system=system_prompt,
                    messages=[{"role": "user", "content": query_text}],
                    tools=[{
                        "type": "web_search_20250305",
                        "name": "web_search",
                        "max_uses": 5,
                    }],
                )
                search_sources = extract_sources_from_claude_response(response)
                content = collect_text(response)
                logger.info(
                    f"[Claude-Natural] Phase 1 complete: {len(content)} chars, {len(search_sources)} sources"
                )
                return (
                    content,
                    search_sources,
                    {
                        'response_id': response.id,
                        'model': self.model,
                        'usage': {
                            'input_tokens': response.usage.input_tokens,
                            'output_tokens': response.usage.output_tokens,
                        },
                        'stop_reason': response.stop_reason,
                        'used_web_search': True,
                    },
                )
            except Exception as error:
                logger.error(
                    "[Claude-Natural] Web search failed, falling back to no web search: %s",
                    error,
                    exc_info=True,
                )

        response = self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            system=system_prompt,
            messages=[{"role": "user", "content": query_text}],
        )
        content = collect_text(response) or (response.content[0].text if response.content else '')
        logger.info(f"[Claude-Natural] Phase 1 complete: {len(content)} chars")
        return (
            content,
            [],
            {
                'response_id': response.id,
                'model': self.model,
                'usage': {
                    'input_tokens': response.usage.input_tokens,
                    'output_tokens': response.usage.output_tokens,
                },
                'stop_reason': response.stop_reason,
                'used_web_search': False,
            },
        )
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
    async def analyze_response(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Phase 2: Analyze the natural response and extract GEO metrics.
        
        Args:
            context: Must include naturalResponse, brandName, queryText, brandDomains
            
        Returns:
            Structured analysis with answer_block and analysis metadata
        """
        natural_response = context['naturalResponse']
        brand_name = context['brandName']
        query_text = context['queryText']
        brand_domains = context.get('brandDomains', [])
        expected_city = context.get('expectedCity', '')
        expected_state = context.get('expectedState', '')
        
        logger.info(f"[Claude-Natural] Phase 2: Analyzing response for brand: {brand_name}")
        
        location_context = f"{expected_city}, {expected_state}" if expected_city and expected_state else "not specified"
        
        analysis_prompt = f"""You are analyzing an LLM's response to extract GEO visibility metrics.

Original Query: {query_text}

LLM Response to Analyze:
---
{natural_response}
---

Brand Information:
- Brand Name: {brand_name}
- Expected Location: {location_context}
- Brand Domains: {', '.join(brand_domains) if brand_domains else 'unknown'}
- Provider search sources: {', '.join(source.get('url') for source in context.get('searchSources') or [] if source.get('url')) or 'None provided.'}

Task: Extract structured data from the LLM response above. Return ONLY a JSON object with:

1. answer_block: The structured GEO data
   - ordered_entities: Array of apartment properties mentioned, in order
     Each entity: {{name, domain, rationale, position}}
   - citations: Array of URLs mentioned
     Each citation: {{url, domain, entity_ref}}
   - answer_summary: Brief summary of what the LLM said
   - notes.flags: Quality flags if applicable

2. analysis: Metadata about the extraction
   - brand_mentioned: boolean
   - brand_prominence: high/medium/low/none
   - extraction_confidence: 0.0-1.0
   - ordered_entities: Detailed extraction data

CRITICAL:
- Extract EVERY named property, community, builder, or listing brand. An empty ordered_entities array is only valid if the response names none of those.
- If {brand_name} is mentioned, it MUST appear in ordered_entities
- Position numbers start at 1 (the first mentioned property)
- Only include properties that were actually mentioned in the response
- If location doesn't match {location_context}, add flag "nap_mismatch"
- Do not flag possible_hallucination when {brand_name} is named in the response.
- You may include provider search sources in citations even when the prose has no URLs.

Output ONLY valid JSON, no markdown."""

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=4000,  # Increased to avoid truncation in detailed analysis
                system='You are a precise GEO extraction system. Output ONLY valid JSON without markdown or extra text.',
                messages=[
                    {"role": "user", "content": analysis_prompt}
                ]
            )
            
            content = response.content[0].text
            
            # Parse JSON
            import json
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                match = re.search(r'\{[\s\S]*\}', content)
                if match:
                    parsed = json.loads(match.group(0))
                else:
                    raise ValueError("Could not parse JSON from analysis")
            
            logger.info("[Claude-Natural] Phase 2 complete")
            
            # Ensure structure
            if 'answer_block' not in parsed:
                parsed = {'answer_block': parsed, 'analysis': {}}
            
            answer_block = parsed.get('answer_block', {})
            
            if 'ordered_entities' not in answer_block:
                answer_block['ordered_entities'] = []
            if 'citations' not in answer_block:
                answer_block['citations'] = []
            if 'answer_summary' not in answer_block:
                answer_block['answer_summary'] = natural_response[:200]
            if 'notes' not in answer_block:
                answer_block['notes'] = {'flags': []}
            
            return {
                'envelope': parsed,
                'raw': {
                    'response_id': response.id,
                    'model': self.model,
                    'usage': {
                        'input_tokens': response.usage.input_tokens,
                        'output_tokens': response.usage.output_tokens
                    }
                }
            }
            
        except Exception as e:
            logger.error(f"[Claude-Natural] Phase 2 error: {e}", exc_info=True)
            return {
                'envelope': {
                    'answer_block': {
                        'ordered_entities': [],
                        'citations': [],
                        'answer_summary': natural_response[:200],
                        'notes': {'flags': ['possible_hallucination']}
                    },
                    'analysis': {'error': str(e)}
                },
                'raw': {'error': str(e)}
            }
    
    async def invoke_natural_mode(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Complete two-phase natural mode execution."""
        # Phase 1
        natural_text, search_sources, phase1_raw = await self.get_natural_response(
            context['queryText']
        )
        
        # Phase 2
        analyzed = await self.analyze_response({
            'naturalResponse': natural_text,
            'brandName': context['brandName'],
            'queryText': context['queryText'],
            'brandDomains': context.get('brandDomains', []),
            'expectedCity': context.get('propertyLocation', {}).get('city'),
            'expectedState': context.get('propertyLocation', {}).get('state'),
            'searchSources': search_sources,
        })
        
        from connectors.entity_fallback import finalize_answer_block
        from connectors.evaluator import reconcile_citation_flags

        answer_block = analyzed['envelope']['answer_block']
        existing_citations = answer_block.get('citations', []) or []
        existing_urls = {citation.get('url') for citation in existing_citations if citation.get('url')}
        for source in search_sources:
            if source.get('url') and source['url'] not in existing_urls:
                existing_citations.append({
                    'url': source['url'],
                    'domain': source.get('domain') or extract_domain(source['url']),
                    'entity_ref': None,
                })
                existing_urls.add(source['url'])
        answer_block['citations'] = existing_citations
        notes = answer_block.get('notes') or {}
        notes['flags'] = reconcile_citation_flags(notes.get('flags') or [], len(existing_citations))
        answer_block['notes'] = notes
        answer_block = finalize_answer_block(
            answer_block,
            context,
            natural_text,
            analyzed['envelope'].get('analysis'),
        )
        logger.info(
            f"[Claude-Natural] Two-phase complete: {len(search_sources)} web sources, "
            f"{len(answer_block.get('citations') or [])} total citations, "
            f"{len(answer_block.get('ordered_entities') or [])} entities"
        )
        
        return {
            'answer': answer_block,
            'raw': {
                'audit_mode': 'natural',
                'phase1': phase1_raw,
                'phase2': analyzed['raw'],
                'natural_response': natural_text,
                'search_sources': search_sources,
                'analysis': analyzed['envelope'].get('analysis', {})
            }
        }






