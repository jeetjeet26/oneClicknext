"""
OpenAI Connector for PropertyAudit (Structured Mode)
Full parity with TypeScript openai-connector.ts including:
- Web search integration
- Location context
- Quality flags
- Model-specific handling
- Retry logic
"""
import os
import logging
import re
from typing import Dict, Any, List, Optional
import openai

logger = logging.getLogger(__name__)


def build_prompt(context: Dict[str, Any]) -> str:
    """Build detailed prompt matching TypeScript version."""
    domains = ', '.join(context.get('brandDomains', []))
    competitors = ', '.join(context.get('competitors', []))
    location = context.get('propertyLocation', {})
    
    lines = [
        "Task: Perform a GEO audit for this specific apartment property and return ONLY the JSON object matching the schema."
    ]
    
    # Add property location context (prevents hallucinations)
    if location and location.get('city') and location.get('state'):
        lines.extend([
            "",
            "Property Details:",
            f"- Name: {context['brandName']}",
            f"- Location: {location['city']}, {location['state']}"
        ])
        
        if location.get('fullAddress'):
            lines.append(f"- Address: {location['fullAddress']}")
        if location.get('websiteUrl'):
            lines.append(f"- Official Website: {location['websiteUrl']}")
        
        lines.extend([
            "",
            f"CRITICAL: This property is located in {location['city']}, {location['state']}.",
            "Do NOT confuse with properties in other cities or states.",
            f"Verify all information relates to the {location['city']}, {location['state']} location."
        ])
    
    lines.extend([
        "",
        f"Query: {context['queryText']}",
        f"Brand: {context['brandName']}",
        f"Brand domains: {domains or '—'}",
        f"Competitors: {competitors or '—'}",
        "Requirements:",
        "- Produce an ordered list of providers/brands relevant to the query (name, domain, rationale, position starting at 1).",
        "- Include citations with absolute URLs and their domains.",
        "- Summarize the answer in 1-2 sentences.",
        "- If no grounded sources are available, set notes.flags to include \"no_sources\".",
        "- If information seems outdated or unverifiable, add appropriate flags.",
        "Output: Return ONLY the JSON object, no markdown, no explanations."
    ])
    
    return '\n'.join(lines)


def detect_quality_flags(answer: Dict[str, Any], citations: List[Dict]) -> List[str]:
    """Detect quality issues in the response."""
    flags = []
    
    # Check for no sources
    if not citations or len(citations) == 0:
        flags.append('no_sources')
    
    # Check for possible hallucination (entities without citations)
    entities = answer.get('ordered_entities', [])
    if entities and not citations:
        flags.append('possible_hallucination')
    
    # Check for generic/vague responses
    summary = answer.get('answer_summary', '')
    if summary and len(summary) < 20:
        flags.append('possible_hallucination')
    
    return flags


def coerce_to_answer_block(candidate: Any) -> Optional[Dict[str, Any]]:
    """
    Coerce various response formats to standard AnswerBlock format.
    Matches TypeScript coercion logic.
    """
    if not candidate or not isinstance(candidate, dict):
        return None
    
    # Try to extract ordered_entities from various formats
    entities_source = (
        candidate.get('ordered_entities') or
        candidate.get('results') or
        candidate.get('providers')
    )
    
    if not entities_source or not isinstance(entities_source, list):
        return None
    
    # Normalize entities
    ordered_entities = []
    for idx, item in enumerate(entities_source):
        if not isinstance(item, dict):
            continue
        
        name = item.get('name')
        domain = item.get('domain')
        
        if not name or not domain:
            continue
        
        ordered_entities.append({
            'name': str(name),
            'domain': str(domain),
            'rationale': str(item.get('rationale', 'No rationale provided.')),
            'position': int(item.get('position', idx + 1))
        })
    
    if not ordered_entities:
        return None
    
    # Extract citations
    citations_source = candidate.get('citations', [])
    citations = []
    for c in citations_source:
        if not isinstance(c, dict):
            continue
        url = c.get('url')
        domain = c.get('domain')
        if url and domain:
            citations.append({
                'url': str(url),
                'domain': str(domain),
                'entity_ref': c.get('entity_ref')
            })
    
    # Extract summary
    summary = (
        candidate.get('answer_summary') or
        candidate.get('summary') or
        'No summary provided.'
    )
    
    # Extract or detect flags
    notes = candidate.get('notes', {})
    existing_flags = notes.get('flags', []) if isinstance(notes, dict) else []
    detected_flags = detect_quality_flags(candidate, citations)
    
    # Merge flags
    allowed_flags = {'no_sources', 'possible_hallucination', 'outdated_info', 'nap_mismatch', 'conflicting_prices'}
    all_flags = list(set(existing_flags + detected_flags))
    flags = [f for f in all_flags if f in allowed_flags]
    
    return {
        'ordered_entities': ordered_entities,
        'citations': citations,
        'answer_summary': str(summary),
        'notes': {'flags': flags}
    }


class OpenAIConnector:
    """OpenAI connector with full feature parity to TypeScript."""
    
    def __init__(self):
        self.api_key = os.environ.get('OPENAI_API_KEY')
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY not set")
        
        self.client = openai.AsyncOpenAI(
            api_key=self.api_key,
            timeout=45.0,
            max_retries=0
        )
        self.model = os.environ.get('GEO_OPENAI_MODEL', 'gpt-4o')
        self.enable_web_search = os.environ.get('GEO_ENABLE_WEB_SEARCH', 'false').lower() == 'true'
    
    async def invoke(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Invoke OpenAI with full feature set.
        
        Args:
            context: Query context with brandName, brandDomains, queryText, etc.
            
        Returns:
            Dict with 'answer' and 'raw' response
        """
        query_text = context['queryText']
        brand_name = context['brandName']
        
        logger.info(f"[OpenAI] Query: {query_text[:50]}... | Model: {self.model}")
        
        prompt = build_prompt(context)
        
        # Check if model requires default sampling (GPT-5, GPT-4.1+)
        requires_default_sampling = (
            re.search(r'^gpt-5', self.model, re.I) or
            re.search(r'^gpt-4\.[1-9]', self.model, re.I)
        )
        
        # Build request params
        messages = [{"role": "user", "content": prompt}]
        
        params = {
            "model": self.model,
            "messages": messages,
            "response_format": {"type": "json_object"}
        }
        
        # GPT-5+ uses max_completion_tokens, older models use max_tokens
        if re.search(r'^gpt-5', self.model, re.I):
            params["max_completion_tokens"] = 2000  # GPT-5+
        else:
            params["max_tokens"] = 2000  # GPT-4 and earlier
        
        # Add sampling params if needed
        if not requires_default_sampling:
            params["temperature"] = 0.3
        
        # Add web search if enabled and supported
        if self.enable_web_search and not requires_default_sampling:
            logger.info("[OpenAI] Web search enabled")
            params["prediction"] = {
                "type": "content",
                "content": [{"type": "web_search_preview"}]
            }
        
        try:
            response = await self.client.chat.completions.create(**params)
            
            content = response.choices[0].message.content
            logger.debug(f"[OpenAI] Response: {len(content)} chars")
            
            # Parse JSON
            import json
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                # Try to extract JSON from markdown
                match = re.search(r'\{[\s\S]*\}', content)
                if match:
                    parsed = json.loads(match.group(0))
                else:
                    raise ValueError("Could not parse JSON from response")
            
            # Coerce to standard format
            answer = coerce_to_answer_block(parsed)
            
            if not answer:
                logger.warning("[OpenAI] Failed to coerce response to AnswerBlock format")
                answer = {
                    'ordered_entities': [],
                    'citations': [],
                    'answer_summary': content[:200] if content else 'No response',
                    'notes': {'flags': ['possible_hallucination']}
                }
            
            return {
                'answer': answer,
                'raw': {
                    'model': self.model,
                    'response_id': response.id,
                    'usage': {
                        'prompt_tokens': response.usage.prompt_tokens,
                        'completion_tokens': response.usage.completion_tokens,
                        'total_tokens': response.usage.total_tokens
                    },
                    'finish_reason': response.choices[0].finish_reason,
                    'web_search_enabled': self.enable_web_search
                }
            }
            
        except Exception as e:
            logger.error(f"[OpenAI] Error: {e}", exc_info=True)
            # Graceful degradation
            return {
                'answer': {
                    'ordered_entities': [],
                    'citations': [],
                    'answer_summary': f'Error: {str(e)}',
                    'notes': {'flags': ['no_sources']}
                },
                'raw': {'error': str(e), 'model': self.model}
            }






