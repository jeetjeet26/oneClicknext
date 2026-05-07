"""
PropertyAudit Evaluator - Python port of evaluator.ts
Evaluates LLM responses and calculates GEO scores

Scoring Formula (LLM SERP Score):
- Position Component: 45% - LLM rank position (1st = 100%, 10th = 10%)
- Link Component: 25% - Citation link rank position
- SOV Component: 20% - Share of Voice (brand citations / total)
- Accuracy Component: 10% - Absence of warning flags
"""
from typing import Dict, Any, List, Optional


def normalize_domain(domain: str) -> str:
    """Normalize domain for comparison. Handles None/empty values safely."""
    if not domain:
        return ''
    
    normalized = str(domain).lower().strip()
    
    # Remove protocol
    normalized = normalized.replace('https://', '').replace('http://', '')
    
    # Remove www
    normalized = normalized.replace('www.', '', 1)
    
    # Remove trailing slash
    normalized = normalized.rstrip('/')
    
    # Remove paths
    normalized = normalized.split('/')[0]
    
    return normalized


def is_brand_domain(domain: str, brand_domains: List[str]) -> bool:
    """Check if domain matches any brand domain. Handles None/empty values safely."""
    if not domain or not brand_domains:
        return False
    
    normalized = normalize_domain(domain)
    if not normalized:
        return False
    
    for bd in brand_domains:
        if not bd:
            continue
        normalized_brand = normalize_domain(bd)
        if not normalized_brand:
            continue
        if normalized == normalized_brand or normalized.endswith('.' + normalized_brand):
            return True
    return False


def find_brand_entity_rank(answer: Dict[str, Any], context: Dict[str, Any]) -> Optional[int]:
    """Find brand's rank in ordered entities. Handles None values safely."""
    ordered_entities = answer.get('ordered_entities', [])
    if not ordered_entities:
        return None
    
    brand_name = context.get('brandName', '')
    if not brand_name:
        return None
    
    brand_name_lower = brand_name.lower()
    brand_domains = context.get('brandDomains', [])
    
    for entity in ordered_entities:
        if not entity or not isinstance(entity, dict):
            continue
        
        entity_domain = entity.get('domain', '') or ''
        entity_name = entity.get('name', '') or ''
        
        if not entity_name:
            continue
        
        entity_name_lower = entity_name.lower()
        
        # Check domain match
        if brand_domains and entity_domain:
            if is_brand_domain(entity_domain, brand_domains):
                return entity.get('position')
        
        # Check name match
        if brand_name_lower in entity_name_lower:
            return entity.get('position')
        
        # Check partial brand match (main identifier)
        brand_words = [w for w in brand_name_lower.split() if len(w) > 3]
        if brand_words:
            main_brand = brand_words[0]
            generic_words = ['apartments', 'apartment', 'properties', 'property', 'living', 'homes']
            if main_brand not in generic_words and main_brand in entity_name_lower and len(main_brand) >= 4:
                return entity.get('position')
    
    return None


def find_brand_link_rank(answer: Dict[str, Any], context: Dict[str, Any]) -> Optional[int]:
    """Find brand's first citation rank. Handles None values safely."""
    citations = answer.get('citations', [])
    if not citations:
        return None
    
    brand_domains = context.get('brandDomains', [])
    if not brand_domains:
        return None
    
    for idx, citation in enumerate(citations):
        if not citation or not isinstance(citation, dict):
            continue
        domain = citation.get('domain', '') or ''
        if domain and is_brand_domain(domain, brand_domains):
            return idx + 1
    
    return None


def compute_sov(answer: Dict[str, Any], context: Dict[str, Any]) -> Optional[float]:
    """Compute Share of Voice (brand citations / total citations)."""
    citations = answer.get('citations', [])
    if not citations:
        return None
    
    brand_domains = context.get('brandDomains', [])
    brand_count = sum(1 for c in citations if is_brand_domain(c.get('domain', ''), brand_domains))
    
    return brand_count / len(citations)


def compute_presence(answer: Dict[str, Any], context: Dict[str, Any]) -> bool:
    """Determine if brand has presence in response. Handles None values safely."""
    # Check entities
    rank = find_brand_entity_rank(answer, context)
    if rank is not None:
        return True
    
    # Check summary
    summary = answer.get('answer_summary', '') or ''
    brand_name = context.get('brandName', '') or ''
    
    if not summary or not brand_name:
        return False
    
    return brand_name.lower() in summary.lower()


# ============================================================================
# Scoring Components
# ============================================================================

def compute_position_component(rank: Optional[int]) -> float:
    """
    Position Component (45% weight)
    Rank 1 = 100%, Rank 10 = 10%, Rank 11+ = 0%
    """
    if not rank or rank <= 0:
        return 0.0
    
    max_rank = 10
    bounded = min(rank, max_rank)
    score = ((max_rank - bounded + 1) / max_rank) * 100
    
    return max(0.0, min(100.0, score))


def compute_link_component(rank: Optional[int]) -> float:
    """Link Component (25% weight)."""
    if not rank or rank <= 0:
        return 0.0
    
    max_rank = 10
    bounded = min(rank, max_rank)
    score = ((max_rank - bounded + 1) / max_rank) * 100
    
    return max(0.0, min(100.0, score))


def compute_sov_component(sov: Optional[float]) -> float:
    """SOV Component (20% weight)."""
    if sov is None:
        return 0.0
    return max(0.0, min(100.0, sov * 100))


def compute_accuracy_component(flags: List[str]) -> float:
    """
    Accuracy Component (10% weight)
    Penalizes based on quality flags.
    """
    if not flags:
        return 100.0
    
    if 'possible_hallucination' in flags:
        return 0.0
    
    if 'no_sources' in flags:
        return 25.0
    
    # Other flags get partial penalty
    return 60.0


# ============================================================================
# Main Scoring Functions
# ============================================================================

def score_answer(answer: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Score an answer using the GEO scoring formula.
    LLM_SERP_SCORE = 45% Position + 25% Link + 20% SOV + 10% Accuracy
    """
    # Get metrics
    presence = compute_presence(answer, context)
    llm_rank = find_brand_entity_rank(answer, context)
    link_rank = find_brand_link_rank(answer, context)
    sov = compute_sov(answer, context)
    flags = answer.get('notes', {}).get('flags', [])
    
    # Compute component scores
    breakdown = {
        'position': compute_position_component(llm_rank),
        'link': compute_link_component(link_rank),
        'sov': compute_sov_component(sov),
        'accuracy': compute_accuracy_component(flags)
    }
    
    # Calculate weighted score
    score = (
        breakdown['position'] * 0.45 +
        breakdown['link'] * 0.25 +
        breakdown['sov'] * 0.20 +
        breakdown['accuracy'] * 0.10
    )
    
    return {
        'presence': presence,
        'llm_rank': llm_rank,
        'link_rank': link_rank,
        'sov': sov,
        'flags': flags,
        'score': round(score, 2),
        'breakdown': breakdown
    }


def aggregate_scores(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate scores across multiple query results."""
    if not results:
        return {
            'overall_score': 0.0,
            'visibility_pct': 0.0,
            'avg_llm_rank': None,
            'avg_link_rank': None,
            'avg_sov': None
        }
    
    total_score = sum(r.get('score', 0) for r in results)
    visibility_count = sum(1 for r in results if r.get('presence', False))
    
    # Calculate averages
    llm_ranks = [r['llm_rank'] for r in results if r.get('llm_rank') is not None]
    link_ranks = [r['link_rank'] for r in results if r.get('link_rank') is not None]
    sovs = [r['sov'] for r in results if r.get('sov') is not None]
    
    return {
        'overall_score': round(total_score / len(results), 2),
        'visibility_pct': round((visibility_count / len(results)) * 100, 2),
        'avg_llm_rank': round(sum(llm_ranks) / len(llm_ranks), 2) if llm_ranks else None,
        'avg_link_rank': round(sum(link_ranks) / len(link_ranks), 2) if link_ranks else None,
        'avg_sov': round(sum(sovs) / len(sovs), 4) if sovs else None
    }


# ============================================================================
# AI Overview Visibility Checker
# ============================================================================

import os
import httpx
import logging
from typing import Tuple
import urllib.parse

logger = logging.getLogger(__name__)


async def check_ai_overview_visibility(
    query_text: str,
    location: str = None
) -> Tuple[bool, Optional[str]]:
    """
    Check if a query triggers an AI Overview on Google Search.
    Uses SerpAPI to fetch search results and detect AI Overview presence.
    
    Args:
        query_text: The search query to check
        location: Optional location for geo-targeted search (e.g., "San Diego, CA")
    
    Returns:
        Tuple of (is_visible, source_url)
        - is_visible: True if AI Overview was detected
        - source_url: URL of the main source cited in AI Overview (if visible)
    """
    serpapi_key = os.environ.get('SERPAPI_API_KEY')
    
    if not serpapi_key:
        logger.warning("[AI Overview] SERPAPI_API_KEY not set, skipping AI Overview check")
        return (False, None)
    
    try:
        # Build SerpAPI request
        params = {
            'api_key': serpapi_key,
            'engine': 'google',
            'q': query_text,
            'gl': 'us',
            'hl': 'en',
            'num': 10,
        }
        
        # Add location if provided
        if location:
            params['location'] = location
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                'https://serpapi.com/search.json',
                params=params
            )
            if response.status_code == 400 and 'location' in params:
                logger.warning(
                    "[AI Overview] SerpAPI rejected location '%s' for query '%s'; retrying without location",
                    params['location'],
                    query_text[:50],
                )
                params_without_location = {key: value for key, value in params.items() if key != 'location'}
                response = await client.get(
                    'https://serpapi.com/search.json',
                    params=params_without_location
                )
            response.raise_for_status()
            data = response.json()
        
        # Check for AI Overview / SGE / Featured Snippet with AI content
        # SerpAPI returns AI Overview data in different keys depending on format
        ai_overview_visible = False
        source_url = None
        
        # Check for AI Overview (Google SGE)
        if 'ai_overview' in data:
            ai_overview = data['ai_overview']
            ai_overview_visible = True
            
            # Extract source URL if available
            if isinstance(ai_overview, dict):
                sources = ai_overview.get('sources', [])
                if sources and len(sources) > 0:
                    source_url = sources[0].get('link') or sources[0].get('url')
        
        # Also check for answer_box which sometimes contains AI-generated content
        if not ai_overview_visible and 'answer_box' in data:
            answer_box = data['answer_box']
            # Check if it's an AI-style answer (has snippet with no direct attribution)
            if answer_box.get('type') in ['organic_result', 'ai_answer']:
                ai_overview_visible = True
                source_url = answer_box.get('link')
        
        # Check for knowledge_graph with AI features
        if not ai_overview_visible and 'knowledge_graph' in data:
            kg = data['knowledge_graph']
            # Knowledge graphs with detailed descriptions often indicate AI overview
            if kg.get('description') and len(kg.get('description', '')) > 200:
                ai_overview_visible = True
                source_url = kg.get('website') or kg.get('source', {}).get('link')
        
        logger.info(
            f"[AI Overview] Query: '{query_text[:50]}...' -> "
            f"Visible: {ai_overview_visible}, Source: {source_url}"
        )
        
        return (ai_overview_visible, source_url)
        
    except httpx.TimeoutException:
        logger.warning(f"[AI Overview] Timeout checking query: {query_text[:50]}...")
        return (False, None)
    except httpx.HTTPStatusError as e:
        logger.error(f"[AI Overview] HTTP error {e.response.status_code} for query: {query_text[:50]}...")
        return (False, None)
    except Exception as e:
        logger.error(f"[AI Overview] Error checking visibility: {e}")
        return (False, None)






