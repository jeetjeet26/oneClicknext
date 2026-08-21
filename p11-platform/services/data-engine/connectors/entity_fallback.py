"""Deterministic GEO entity backfill when the analyzer returns an empty list."""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional


GENERIC_WORDS = {'apartments', 'apartment', 'properties', 'property', 'living', 'homes'}


def find_mention_index(text: str, name: str) -> Optional[int]:
    trimmed = (name or '').strip()
    if not trimmed or len(trimmed) < 2:
        return None
    match = re.search(rf'\b{re.escape(trimmed)}\b', text or '', flags=re.IGNORECASE)
    return match.start() if match else None


def _normalize_domain(domain: str) -> str:
    normalized = (domain or '').lower().strip()
    normalized = re.sub(r'^https?://', '', normalized)
    normalized = re.sub(r'^www\.', '', normalized)
    return normalized.split('/')[0]


def _is_brand_name(entity_name: str, brand_name: str) -> bool:
    name = (entity_name or '').lower()
    brand = (brand_name or '').lower().strip()
    if not brand:
        return False
    if brand in name:
        return True
    words = [word for word in brand.split() if len(word) > 3]
    if not words:
        return False
    main = words[0]
    return len(main) >= 4 and main not in GENERIC_WORDS and main in name


def _is_brand_domain(domain: str, brand_domains: Iterable[str]) -> bool:
    normalized = _normalize_domain(domain)
    if not normalized:
        return False
    for candidate in brand_domains or []:
        brand = _normalize_domain(candidate)
        if brand and (normalized == brand or normalized.endswith('.' + brand)):
            return True
    return False


def find_tracked_brand_position(
    entities: Iterable[Dict[str, Any]],
    brand_name: str,
    brand_domains: Optional[Iterable[str]] = None,
) -> Optional[int]:
    domains = list(brand_domains or [])
    for entity in entities or []:
        if not isinstance(entity, dict):
            continue
        if domains and _is_brand_domain(entity.get('domain') or '', domains):
            return entity.get('position')
        if _is_brand_name(entity.get('name') or '', brand_name):
            return entity.get('position')
    return None


def _normalize_entities(entities: Optional[Iterable[Any]]) -> List[Dict[str, Any]]:
    seen = set()
    normalized: List[Dict[str, Any]] = []
    for entity in entities or []:
        if not isinstance(entity, dict):
            continue
        name = str(entity.get('name') or '').strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        position = entity.get('position')
        normalized.append({
            'name': name,
            'domain': str(entity.get('domain') or '').strip(),
            'rationale': str(entity.get('rationale') or 'Extracted from the answer text').strip(),
            'position': position if isinstance(position, int) and position > 0 else len(normalized) + 1,
        })
    normalized.sort(key=lambda item: item['position'])
    return normalized


def _known_names(brand_name: str, competitors: Optional[Iterable[str]] = None) -> List[str]:
    names: List[str] = []
    seen = set()
    for value in [brand_name, *(competitors or [])]:
        cleaned = str(value or '').strip()
        if not cleaned or '.' in cleaned or len(cleaned) < 2:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        names.append(cleaned)
    return names


def _extract_entities_from_text(
    text: str,
    brand_name: str,
    brand_domains: Optional[Iterable[str]] = None,
    competitors: Optional[Iterable[str]] = None,
) -> List[Dict[str, Any]]:
    hits = []
    for name in _known_names(brand_name, competitors):
        index = find_mention_index(text, name)
        if index is None:
            continue
        hits.append((index, name))
    hits.sort(key=lambda item: item[0])
    domains = list(brand_domains or [])
    return [
        {
            'name': name,
            'domain': domains[0] if _is_brand_name(name, brand_name) and domains else '',
            'rationale': f'First mentioned in the answer at character {index + 1}.',
            'position': position,
        }
        for position, (index, name) in enumerate(hits, start=1)
    ]


def _ensure_brand_in_list(
    entities: List[Dict[str, Any]],
    text: str,
    brand_name: str,
    brand_domains: Optional[Iterable[str]] = None,
    competitors: Optional[Iterable[str]] = None,
) -> List[Dict[str, Any]]:
    if find_tracked_brand_position(entities, brand_name, brand_domains) is not None:
        return entities
    if find_mention_index(text, brand_name) is None:
        return entities
    extracted = _extract_entities_from_text(text, brand_name, brand_domains, competitors)
    brand = next((entity for entity in extracted if _is_brand_name(entity['name'], brand_name)), None)
    next_position = max((entity.get('position') or 0 for entity in entities), default=0) + 1
    return _normalize_entities([
        *entities,
        {
            'name': (brand or {}).get('name') or brand_name,
            'domain': (brand or {}).get('domain') or (list(brand_domains or []) or [''])[0],
            'rationale': (brand or {}).get('rationale') or 'Tracked brand was named in the answer but omitted from the extracted list.',
            'position': next_position,
        },
    ])


def ensure_ordered_entities(
    existing: Optional[Iterable[Any]],
    analysis_entities: Optional[Iterable[Any]],
    brand_name: str,
    brand_domains: Optional[Iterable[str]] = None,
    competitors: Optional[Iterable[str]] = None,
    text: str = '',
) -> List[Dict[str, Any]]:
    current = _normalize_entities(existing)
    if current:
        return _ensure_brand_in_list(current, text, brand_name, brand_domains, competitors)
    from_analysis = _normalize_entities(analysis_entities)
    if from_analysis:
        return _ensure_brand_in_list(from_analysis, text, brand_name, brand_domains, competitors)
    return _extract_entities_from_text(text, brand_name, brand_domains, competitors)


def reconcile_hallucination_flags(flags: Optional[Iterable[str]], text: str, brand_name: str) -> List[str]:
    next_flags = [flag for flag in (flags or [])]
    if find_mention_index(text, brand_name) is None:
        return next_flags
    return [flag for flag in next_flags if flag != 'possible_hallucination']


def finalize_answer_block(
    answer_block: Dict[str, Any],
    context: Dict[str, Any],
    natural_text: str = '',
    analysis: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    source_text = '\n'.join(
        part for part in [
            natural_text,
            context.get('sourceText') or '',
            answer_block.get('answer_summary') or '',
        ] if part
    )
    expected_city = context.get('expectedCity') or (context.get('propertyLocation') or {}).get('city')
    analysis_entities = (analysis or {}).get('ordered_entities') if isinstance(analysis, dict) else None
    answer_block['ordered_entities'] = ensure_ordered_entities(
        existing=answer_block.get('ordered_entities'),
        analysis_entities=analysis_entities,
        brand_name=context.get('brandName') or '',
        brand_domains=context.get('brandDomains') or [],
        competitors=context.get('competitors') or [],
        text=source_text,
    )
    notes = answer_block.get('notes') or {}
    notes['flags'] = reconcile_hallucination_flags(
        notes.get('flags') or [],
        source_text,
        context.get('brandName') or '',
    )
    answer_block['notes'] = notes
    if expected_city:
        answer_block.setdefault('_expected_city', expected_city)
    return answer_block
