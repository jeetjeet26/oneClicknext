"""
Claude Natural Connector (Two-Phase GEO)
Phase 1: Get natural conversational response (like real Claude)
Phase 2: Analyze that response to extract GEO metrics
"""
import os
import logging
import re
from typing import Dict, Any, List, Tuple
import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


class ClaudeNaturalConnector:
    """Two-phase natural mode connector for Claude."""
    
    def __init__(self):
        self.api_key = os.environ.get('ANTHROPIC_API_KEY')
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY not set")
        
        self.client = anthropic.Anthropic(api_key=self.api_key)
        self.model = os.environ.get('GEO_CLAUDE_MODEL', 'claude-sonnet-4-20250514')
        self.enable_web_search = os.environ.get('GEO_ENABLE_WEB_SEARCH', 'false').lower() == 'true'
        
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
        search_sources = []
        
        # Claude natural-mode web search stays disabled until source extraction is implemented.
        web_search_disabled_reason = None
        if self.enable_web_search:
            web_search_disabled_reason = (
                "Claude natural-mode web search is disabled until source extraction is implemented."
            )
            logger.warning(f"[Claude-Natural] {web_search_disabled_reason}")
        
        # Standard call without web search
        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=2000,
                temperature=0,
                system=system_prompt,
                messages=[
                    {"role": "user", "content": query_text}
                ]
            )
            
            content = response.content[0].text
            logger.info(f"[Claude-Natural] Phase 1 complete: {len(content)} chars")
            
            return (
                content,
                [],  # No sources without web search
                {
                    'response_id': response.id,
                    'model': self.model,
                    'usage': {
                        'input_tokens': response.usage.input_tokens,
                        'output_tokens': response.usage.output_tokens
                    },
                    'stop_reason': response.stop_reason,
                    'used_web_search': False,
                    'web_search_disabled_reason': web_search_disabled_reason,
                }
            )
            
        except Exception as e:
            logger.error(f"[Claude-Natural] Phase 1 error: {e}", exc_info=True)
            raise
    
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
- If {brand_name} is mentioned, it MUST appear in ordered_entities
- Position numbers start at 1 (the first mentioned property)
- Only include properties that were actually mentioned in the response
- If location doesn't match {location_context}, add flag "nap_mismatch"

Output ONLY valid JSON, no markdown."""

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=4000,  # Increased to avoid truncation in detailed analysis
                temperature=0,  # Zero temp for precise extraction (matches TypeScript)
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
            'expectedState': context.get('propertyLocation', {}).get('state')
        })
        
        # Merge Phase 1 web sources into citations for SOV calculation
        answer_block = analyzed['envelope']['answer_block']
        existing_citations = answer_block.get('citations', [])
        existing_urls = {c.get('url') for c in existing_citations if c.get('url')}
        
        # Add web search sources as citations (for SOV calculation)
        for source in search_sources:
            if source.get('url') and source['url'] not in existing_urls:
                existing_citations.append({
                    'url': source['url'],
                    'domain': source.get('domain', ''),
                    'entity_ref': None
                })
                existing_urls.add(source['url'])
        
        answer_block['citations'] = existing_citations
        
        logger.info(f"[Claude-Natural] Two-phase complete: {len(search_sources)} web sources, {len(existing_citations)} total citations")
        
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






