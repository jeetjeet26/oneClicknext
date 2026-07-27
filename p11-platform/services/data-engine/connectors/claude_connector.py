"""
Claude (Anthropic) Connector for PropertyAudit (Structured Mode)
Full parity with TypeScript claude-connector.ts including:
- Location context
- Quality flags
- Retry logic
"""
import os
import logging
from typing import Dict, Any, Optional
import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


def build_prompt(context: Dict[str, Any]) -> str:
    """Build detailed prompt matching TypeScript version."""
    domains = ', '.join(context.get('brandDomains', []))
    competitors = ', '.join(context.get('competitors', []))
    location = context.get('propertyLocation', {})
    
    lines = [
        "Task: Perform a GEO audit for this specific apartment property and return ONLY the JSON object matching the schema."
    ]
    
    # Add property location context
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
        "Output: Return ONLY the JSON object, no markdown, no explanations."
    ])
    
    return '\n'.join(lines)


def coerce_to_answer_block(candidate: Any) -> Optional[Dict[str, Any]]:
    """Coerce response to standard AnswerBlock format."""
    if not candidate or not isinstance(candidate, dict):
        return None
    
    entities_source = (
        candidate.get('ordered_entities') or
        candidate.get('results') or
        candidate.get('providers')
    )
    
    if not entities_source or not isinstance(entities_source, list):
        return None
    
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
    
    summary = (
        candidate.get('answer_summary') or
        candidate.get('summary') or
        'No summary provided.'
    )
    
    notes = candidate.get('notes', {})
    flags = notes.get('flags', []) if isinstance(notes, dict) else []
    
    # Add quality flags
    if not citations:
        flags.append('no_sources')
    
    allowed_flags = {'no_sources', 'possible_hallucination', 'outdated_info', 'nap_mismatch', 'conflicting_prices'}
    flags = [f for f in flags if f in allowed_flags]
    
    return {
        'ordered_entities': ordered_entities,
        'citations': citations,
        'answer_summary': str(summary),
        'notes': {'flags': flags}
    }


class ClaudeConnector:
    """Claude connector with full feature parity to TypeScript."""
    
    def __init__(self):
        self.api_key = os.environ.get('ANTHROPIC_API_KEY')
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY not set")
        
        self.client = anthropic.Anthropic(api_key=self.api_key)
        self.model = os.environ.get('GEO_CLAUDE_MODEL', 'claude-sonnet-5')
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
    async def invoke(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Invoke Claude with full feature set.
        
        Args:
            context: Query context with brandName, brandDomains, queryText, etc.
            
        Returns:
            Dict with 'answer' and 'raw' response
        """
        query_text = context['queryText']
        
        logger.info(f"[Claude] Query: {query_text[:50]}... | Model: {self.model}")
        
        prompt = build_prompt(context)
        
        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=2000,
                temperature=0.3,
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )
            
            content = response.content[0].text
            logger.debug(f"[Claude] Response: {len(content)} chars")
            
            # Parse JSON
            import json
            import re
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                # Try to extract JSON
                match = re.search(r'\{[\s\S]*\}', content)
                if match:
                    parsed = json.loads(match.group(0))
                else:
                    raise ValueError("Could not parse JSON from response")
            
            # Coerce to standard format
            answer = coerce_to_answer_block(parsed)
            
            if not answer:
                logger.warning("[Claude] Failed to coerce response to AnswerBlock format")
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
                        'input_tokens': response.usage.input_tokens,
                        'output_tokens': response.usage.output_tokens
                    },
                    'stop_reason': response.stop_reason
                }
            }
            
        except Exception as e:
            logger.error(f"[Claude] Error: {e}", exc_info=True)
            return {
                'answer': {
                    'ordered_entities': [],
                    'citations': [],
                    'answer_summary': f'Error: {str(e)}',
                    'notes': {'flags': ['no_sources']}
                },
                'raw': {'error': str(e), 'model': self.model}
            }






