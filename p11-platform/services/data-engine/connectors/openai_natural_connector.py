"""
OpenAI Natural Connector (Two-Phase GEO) - CORRECTED VERSION
Uses OpenAI Responses API (not Chat Completions) with web_search_preview TOOL

Key differences from my first attempt:
- client.responses.create() NOT chat.completions.create()
- Web search is a TOOL: tools=[{type: 'web_search_preview'}]
- Sources extracted from response.output[].content[].annotations
- Matches TypeScript implementation exactly
"""
import os
import logging
import re
import json
from typing import Dict, Any, List, Tuple, Optional
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


def extract_domain_from_url(url: str) -> str:
    """Extract domain from URL."""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.hostname or url
        return domain.replace('www.', '', 1)
    except:
        return url


def extract_sources_from_annotations(annotations: List[Any]) -> List[Dict[str, str]]:
    """
    Extract web search sources from OpenAI Responses API annotations.
    Annotations contain url_citation types with source URLs.
    """
    if not annotations:
        logger.debug("No annotations provided")
        return []
    
    sources = []
    seen_urls = set()
    
    for annotation in annotations:
        # Handle both dict and object types
        ann_dict = annotation if isinstance(annotation, dict) else vars(annotation)
        
        ann_type = ann_dict.get('type')
        ann_url = ann_dict.get('url')
        
        logger.debug(f"Annotation: type={ann_type}, url={ann_url}")
        
        if ann_type == 'url_citation' and ann_url:
            if ann_url in seen_urls:
                continue
            seen_urls.add(ann_url)
            
            sources.append({
                'title': ann_dict.get('title', ''),
                'url': ann_url,
                'domain': extract_domain_from_url(ann_url),
                'snippet': ''
            })
    
    logger.info(f"Extracted {len(sources)} sources from {len(annotations)} annotations")
    return sources


def build_analyzer_prompt(ctx: Dict[str, Any]) -> str:
    """Build Phase 2 analysis prompt matching TypeScript exactly."""
    expected = f"{ctx.get('expectedCity', '')}, {ctx.get('expectedState', '')}" if ctx.get('expectedCity') else 'Unknown'
    brand_domains = ', '.join(ctx.get('brandDomains', [])) or '—'
    competitors = ', '.join(ctx.get('competitors', [])) or '—'
    
    lines = [
        "You are a GEO audit analyzer extracting structured data from a natural LLM response.",
        "",
        "IMPORTANT: Be objective. Extract what was ACTUALLY said, not what should have been said.",
        "Do not invent citations or URLs. Only extract or infer when clearly implied.",
        "",
        f'Original Query: "{ctx["queryText"]}"',
        f'Brand Being Tracked: "{ctx["brandName"]}"',
        f'Expected Location: {expected}',
        f'Known brand domains (for inference only): {brand_domains}',
        f'Known competitor domains (for inference only): {competitors}',
        "",
        "LLM's Natural Response to Analyze:",
        '"""',
        ctx['naturalResponse'],
        '"""',
        "",
        "Return ONLY JSON matching the required schema.",
        "",
        "Rules:",
        "- ordered_entities in answer_block MUST be ordered by prominence (best-effort): frequency + early mention + emphasis.",
        "- For answer_block.ordered_entities[].rationale: include a short reason + the first_mention_quote in-line.",
        '- If no explicit URLs appear, citations may be empty; set notes.flags to include "no_sources" when appropriate.',
        "- brand_analysis.location_correct should be false if a different city/state is stated than Expected Location (when Expected Location is known).",
        "- brand_analysis includes: mentioned (bool), position (int or null), location_stated (str or null), location_correct (bool or null), prominence (str or null)",
        "- analysis.ordered_entities should include: name, domain, position, prominence, mention_count, first_mention_quote",
        "- extraction_confidence: 0-100 (how confident you are in the extraction)"
    ]
    
    return '\n'.join(lines)


class OpenAINaturalConnector:
    """Two-phase natural mode using OpenAI Responses API."""
    
    def __init__(self):
        self.api_key = os.environ.get('OPENAI_API_KEY')
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY not set")
        
        self.client = OpenAI(
            api_key=self.api_key,
            timeout=600.0,
            max_retries=2
        )
        self.model = os.environ.get('GEO_OPENAI_MODEL', 'gpt-4o')
        self.enable_web_search = os.environ.get('GEO_ENABLE_WEB_SEARCH', 'false').lower() == 'true'
        
        logger.info(f"[OpenAINatural] Model: {self.model}, Web search: {self.enable_web_search}")
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
    async def get_natural_response(self, query_text: str) -> Tuple[str, List[Dict], Dict]:
        """
        Phase 1: Get natural conversational response using Responses API.
        NO property context provided - simulates real ChatGPT user experience.
        
        Returns:
            (response_text, search_sources, raw_response)
        """
        logger.info(f"[OpenAINatural] Phase 1: Natural response for: {query_text[:60]}...")
        
        search_sources = []
        
        # System prompt - conversational, no JSON
        system_prompt = 'You are a helpful assistant. Answer naturally in conversational prose. Do not output JSON. If unsure, say so plainly.'
        
        if self.enable_web_search:
            # Use Responses API with web_search_preview TOOL
            try:
                logger.info("[OpenAINatural] Using Responses API with web_search_preview tool")
                
                response = self.client.responses.create(
                    model=self.model,
                    input=query_text,
                    instructions=system_prompt,
                    tools=[{'type': 'web_search_preview'}]
                )
                
                # Extract text and annotations from response.output
                text = ''
                all_annotations = []
                
                for item in response.output or []:
                    if item.type == 'message' and item.content:
                        for content_block in item.content:
                            if content_block.type == 'output_text':
                                text += content_block.text or ''
                                if hasattr(content_block, 'annotations') and content_block.annotations:
                                    all_annotations.extend(content_block.annotations)
                
                # Extract sources from annotations
                search_sources = extract_sources_from_annotations(all_annotations)
                logger.info(f"[OpenAINatural] Phase 1 complete: {len(text)} chars, {len(search_sources)} sources")
                
                return (
                    text,
                    search_sources,
                    {
                        'response_id': response.id,
                        'model': self.model,
                        'usage': {
                            'total_tokens': response.usage.total_tokens if response.usage else 0
                        },
                        'used_web_search': True
                    }
                )
                
            except Exception as e:
                logger.error(f"[OpenAINatural] Responses API error: {e}", exc_info=True)
                logger.warning("[OpenAINatural] Falling back to Chat Completions API (no web sources)")
                # Fall through to fallback
        
        # Fallback: Chat Completions API (no web search sources)
        logger.info("[OpenAINatural] Using Chat Completions API (fallback)")
        
        completion = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': query_text}
            ],
            temperature=0.7
        )
        
        text = completion.choices[0].message.content or ''
        
        return (
            text,
            [],  # No sources in fallback mode
            {
                'response_id': completion.id,
                'model': self.model,
                'usage': {
                    'prompt_tokens': completion.usage.prompt_tokens,
                    'completion_tokens': completion.usage.completion_tokens,
                    'total_tokens': completion.usage.total_tokens
                },
                'used_web_search': False
            }
        )
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
    async def analyze_response(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Phase 2: Analyze natural response with detailed prompt.
        NOW we provide brand context to extract GEO metrics.
        """
        natural_response = context['naturalResponse']
        brand_name = context['brandName']
        query_text = context['queryText']
        
        logger.info(f"[OpenAINatural] Phase 2: Analyzing for brand: {brand_name}")
        
        prompt = build_analyzer_prompt(context)
        
        try:
            # Use Chat Completions with STRICT JSON SCHEMA for structured analysis
            from connectors.schemas import NATURAL_EXTRACTION_ENVELOPE_SCHEMA
            
            # GPT-5+ requires max_completion_tokens instead of max_tokens
            params = {
                "model": self.model,
                "messages": [
                    {
                        'role': 'system',
                        'content': 'You are a precise GEO extraction system. Output strict JSON only. Do not include markdown or explanations.'
                    },
                    {'role': 'user', 'content': prompt}
                ],
                "response_format": {
                    'type': 'json_schema',
                    'json_schema': {
                        'name': 'NaturalExtractionEnvelope',
                        'strict': True,
                        'schema': NATURAL_EXTRACTION_ENVELOPE_SCHEMA
                    }
                },
                "temperature": 0.1
            }
            
            # GPT-5+ uses max_completion_tokens, older models use max_tokens
            if re.search(r'^gpt-5', self.model, re.I):
                params["max_completion_tokens"] = 4000  # GPT-5+
            else:
                params["max_tokens"] = 4000  # GPT-4 and earlier
            
            response = self.client.chat.completions.create(**params)
            
            content = response.choices[0].message.content
            
            # Parse JSON
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                match = re.search(r'\{[\s\S]*\}', content)
                if match:
                    parsed = json.loads(match.group(0))
                else:
                    raise ValueError("Could not parse JSON from Phase 2 analysis")
            
            # Ensure proper structure
            if 'answer_block' not in parsed:
                # If they returned answer_block fields at root, wrap it
                parsed = {'answer_block': parsed, 'analysis': {}}
            
            answer_block = parsed.get('answer_block', {})
            
            # Ensure all required fields
            if 'ordered_entities' not in answer_block:
                answer_block['ordered_entities'] = []
            if 'citations' not in answer_block:
                answer_block['citations'] = []
            if 'answer_summary' not in answer_block:
                answer_block['answer_summary'] = natural_response[:200]
            if 'notes' not in answer_block:
                answer_block['notes'] = {'flags': []}
            elif 'flags' not in answer_block['notes']:
                answer_block['notes']['flags'] = []
            
            logger.info("[OpenAINatural] Phase 2 complete")
            
            return {
                'envelope': parsed,
                'raw': {
                    'response_id': response.id,
                    'model': self.model,
                    'usage': {
                        'prompt_tokens': response.usage.prompt_tokens,
                        'completion_tokens': response.usage.completion_tokens,
                        'total_tokens': response.usage.total_tokens
                    }
                }
            }
            
        except Exception as e:
            logger.error(f"[OpenAINatural] Phase 2 error: {e}", exc_info=True)
            # Graceful fallback
            return {
                'envelope': {
                    'answer_block': {
                        'ordered_entities': [],
                        'citations': [],
                        'answer_summary': natural_response[:200],
                        'notes': {'flags': ['possible_hallucination']}
                    },
                    'analysis': {'error': str(e), 'extraction_confidence': 0}
                },
                'raw': {'error': str(e)}
            }
    
    async def invoke_natural_mode(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Complete two-phase execution."""
        # Phase 1: Natural response with web search
        natural_text, search_sources, phase1_raw = await self.get_natural_response(
            context['queryText']
        )
        
        # Phase 2: Structured analysis
        analyzed = await self.analyze_response({
            'naturalResponse': natural_text,
            'brandName': context['brandName'],
            'queryText': context['queryText'],
            'brandDomains': context.get('brandDomains', []),
            'competitors': context.get('competitors', []),
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
                    'domain': source.get('domain', extract_domain_from_url(source['url'])),
                    'entity_ref': None  # Web search sources don't have entity refs
                })
                existing_urls.add(source['url'])
        
        answer_block['citations'] = existing_citations
        
        logger.info(f"[OpenAINatural] Two-phase complete: {len(search_sources)} web sources, {len(existing_citations)} total citations")
        
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






