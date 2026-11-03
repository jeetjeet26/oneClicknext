"""Bounded, community-informed discovery. Relevance never excludes residential alternatives."""
import math
import re
from typing import Optional
from pydantic import BaseModel, Field
from scrapers.base import ScrapedProperty


class KnowledgeSignal(BaseModel):
    id: str = Field(max_length=200)
    text: str = Field(max_length=2000)


class DiscoveryKnowledge(BaseModel):
    property_id: str
    context_hash: str = Field(max_length=100)
    property_type: str = Field(default='', max_length=100)
    signals: list[KnowledgeSignal] = Field(default_factory=list, max_length=30)
    known_competitors: list[str] = Field(default_factory=list, max_length=5)
    known_competitor_source_ids: list[str] = Field(default_factory=list, max_length=5)
    avg_rent: Optional[float] = Field(default=None, gt=0)
    amenities: list[str] = Field(default_factory=list, max_length=100)
    bedrooms: list[float] = Field(default_factory=list, max_length=30)


# Explicit wording only. A name-based classification is always shown as provisional.
SEGMENTS = {
    'active_adult': ('senior', r'\b(?:active adult|55\s*\+|age.restricted)\b|55\s*\+'),
    'independent_living': ('senior', r'\bindependent living\b'),
    'assisted_living': ('senior', r'\bassisted living\b'),
    'memory_care': ('senior', r'\bmemory care\b'),
    'senior': ('senior', r'\b(?:senior|retirement)\b'),
    'student': ('student', r'\b(?:student|off.campus)\b'),
    'affordable': ('affordable', r'\b(?:affordable|income.restricted|income qualified)\b'),
    'luxury': ('multifamily', r'\b(?:luxury|premium apartments)\b'),
    'townhome': ('townhome', r'\b(?:townhome|townhouse)s?\b'),
    'condo': ('condo', r'\b(?:condo|condominium)s?\b'),
    'single_family': ('single_family', r'\bsingle.family\b'),
    'master_planned': ('master_planned', r'\bmaster.planned\b'),
    'multifamily': ('multifamily', r'\b(?:apartment|multifamily|multi.family)s?\b'),
}
TERMS = {'active_adult': 'active adult 55+ communities', 'independent_living': 'independent living communities',
         'assisted_living': 'assisted living communities', 'memory_care': 'memory care communities',
         'senior': 'senior living communities', 'student': 'student apartments', 'affordable': 'affordable housing',
         'luxury': 'luxury apartments', 'townhome': 'townhome communities', 'condo': 'condo communities',
         'single_family': 'single family home communities', 'master_planned': 'master planned communities',
         'multifamily': 'apartment communities', 'mixed_use': 'mixed use apartments'}
FOR_SALE = {'townhome', 'condo', 'single_family', 'master_planned'}
SERVICES = {'dining': r'\b(?:dining|meal service)\b', 'transportation': r'\b(?:transportation|shuttle)\b',
            'nursing': r'\b(?:nursing|nurse)\b', 'housekeeping': r'\bhousekeeping\b',
            'fitness': r'\b(?:fitness|gym)\b', 'pet friendly': r'\bpet.friendly\b'}


def service_tags(text):
    text = re.sub(r'\b(?:no|not|without|does not offer)\b[^.;\n]*', '', text.lower())
    return {name for name, pattern in SERVICES.items() if re.search(pattern, text)}


def normalize(value):
    return re.sub(r'[^a-z0-9]', '', (value or '').lower())


def segments(text):
    # Negated offerings must not become positive search signals.
    text = re.sub(r'\b(?:no|not|without|does not offer)\b[^.;\n]*', '', text.lower())
    found = {key for key, (_, pattern) in SEGMENTS.items() if re.search(pattern, text)}
    if found & {'active_adult', 'independent_living', 'assisted_living', 'memory_care'}:
        found.discard('senior')
    return found


def miles(lat, lng, other_lat, other_lng):
    if any(v is None or not math.isfinite(v) for v in (lat, lng, other_lat, other_lng)):
        return None
    a, b = math.radians(lat), math.radians(other_lat)
    dlat, dlng = b-a, math.radians(other_lng-lng)
    h = math.sin(dlat/2)**2 + math.cos(a)*math.cos(b)*math.sin(dlng/2)**2
    return 3958.7613 * 2 * math.asin(min(1, math.sqrt(h)))


def subject_profile(property_data, knowledge=None):
    kind = (knowledge.property_type if knowledge else '') or property_data.get('property_type') or ''
    signals = knowledge.signals if knowledge else []
    specific = set()
    used = ['property:property_type'] if kind else []
    transaction = None
    explicit_subtypes = set()
    services = set()
    for signal in signals:
        if re.search(r'competitor|competing|nearby communities', signal.text, re.I):
            continue
        if 'transaction_model:' in signal.text:
            transaction = 'rental' if re.search(r'rent|lease', signal.text, re.I) else 'for_sale' if re.search(r'ownership|for sale|purchase', signal.text, re.I) else 'care_services' if re.search(r'care', signal.text, re.I) else None
        detected = segments(signal.text)
        offered_services = service_tags(signal.text)
        services |= offered_services
        if 'community_subtype:' in signal.text:
            explicit_subtypes |= detected
        if detected:
            specific |= detected
        if detected or offered_services or 'transaction_model:' in signal.text:
            used.append(signal.id)
    conflict = bool(explicit_subtypes and kind and kind not in {'multifamily', 'luxury', 'mixed_use'} and not any(SEGMENTS[s][0] == kind for s in explicit_subtypes))
    if explicit_subtypes:
        specific = explicit_subtypes
    if kind == 'senior' and not conflict:
        specific = {s for s in specific if SEGMENTS[s][0] == 'senior'} or {'senior'}
    elif kind and not conflict:
        specific.add(kind)
    if specific & {'active_adult', 'independent_living', 'assisted_living', 'memory_care'}:
        specific.discard('senior')
    warnings = []
    if conflict:
        warnings.append('The saved community type differs from its reviewed living options. Matching prioritizes the reviewed living options; review the community facts.')
    if not specific:
        warnings.append('Community type is not specified. Results use broad residential searches.')
    if specific == {'senior'}:
        warnings.append('Senior living subtype is missing. Add active adult, independent living, assisted living or memory care to reviewed community facts.')
    return {'segments': sorted(specific), 'source_ids': used[:20], 'context_hash': knowledge.context_hash if knowledge else None,
            'services': sorted(services), 'transaction': transaction, 'summary': (transaction.replace('_', ' ') + ' · ' if transaction else '') + ', '.join(s.replace('_', ' ') for s in sorted(specific)) or 'Nearby residential communities',
            'warnings': warnings}


def search_terms(profile, knowledge=None):
    direct = [TERMS[s] for s in profile['segments'] if s in TERMS][:3]
    if profile.get('transaction') == 'rental':
        direct = [term + ' for rent' for term in direct]
    elif profile.get('transaction') == 'for_sale':
        direct = [term + ' for sale' for term in direct]
    related = ['senior living communities'] if any(SEGMENTS.get(s, ('',))[0] == 'senior' for s in profile['segments']) else ['residential communities']
    broad = ['apartments for rent', 'homes for sale communities'] if set(profile['segments']) & FOR_SALE else ['apartments for rent', 'townhome communities']
    known = knowledge.known_competitors if knowledge else []
    service_search = [direct[0] + ' ' + profile['services'][0]] if direct and profile.get('services') else []
    return list(dict.fromkeys(direct + related + broad + service_search + known))[:12]


def rank_candidates(properties, property_data, knowledge, profile, lat, lng, radius, existing):
    result, seen = [], set()
    excluded = {normalize(property_data['name'])} | {normalize(c['name']) for c in existing}
    subject_segments = set(profile['segments'])
    subject_family = {SEGMENTS.get(s, (s,))[0] for s in subject_segments}
    known = {normalize(n) for n in knowledge.known_competitors} if knowledge else set()
    missing_coordinates = 0
    for prop in properties:
        distance = miles(lat, lng, prop.latitude, prop.longitude)
        if distance is None:
            missing_coordinates += 1
            continue
        if distance > radius or normalize(prop.name) in excluded:
            continue
        identity = prop.source_url if 'place_id:' in prop.source_url else normalize(prop.name) + normalize(prop.address)
        alias = normalize(prop.name) + normalize(prop.address)
        if identity in seen or alias in seen:
            continue
        seen.update((identity, alias))
        candidate_segments = segments(prop.name)
        # Generic scraper defaults are not evidence of community type.
        if prop.property_type != 'multifamily':
            candidate_segments.add(prop.property_type)
        family = {SEGMENTS.get(s, (s,))[0] for s in candidate_segments}
        overlap = candidate_segments & subject_segments
        # Generic apartments cannot outrank the explicit specialized audience.
        specialized = subject_segments - {'multifamily', 'luxury'}
        if specialized:
            overlap -= {'multifamily', 'luxury'}
        tier = 'primary' if overlap else 'related' if family & subject_family else 'broader'
        reasons = []
        if overlap:
            reasons.append('Name or listing suggests matching ' + ', '.join(s.replace('_', ' ') for s in sorted(overlap)) + '.')
        elif family & subject_family:
            reasons.append('Related housing category; living options or services may differ.')
        else:
            reasons.append('Nearby residential alternative; a direct offering match is not established.')
        if profile.get('transaction'):
            candidate_model = 'rental' if re.search(r'for rent|rental|leasing', prop.name, re.I) else 'for_sale' if re.search(r'for sale|ownership', prop.name, re.I) else None
            if candidate_model and candidate_model != profile['transaction']:
                tier = 'related' if tier == 'primary' else tier
                reasons.append('Different rental or ownership model.')
        score = {'primary': 60, 'related': 30, 'broader': 0}[tier]
        source_ids = list(profile['source_ids'])
        if normalize(prop.name) in known:
            source_ids.extend(knowledge.known_competitor_source_ids)
            score += 10
            reasons.append('Named in reviewed community knowledge.')
        shared_services = set(profile.get('services', [])) & service_tags(prop.name + ' ' + ' '.join(prop.amenities))
        if shared_services:
            score += min(5, len(shared_services)*2)
            reasons.append('Name or listing suggests shared services: ' + ', '.join(sorted(shared_services)) + '; verify with the community.')
        if knowledge and knowledge.amenities and prop.amenities:
            shared = set(a.lower() for a in knowledge.amenities) & set(a.lower() for a in prop.amenities)
            score += min(5, len(shared))
            if shared:
                reasons.append('Shared amenities: ' + ', '.join(sorted(shared)[:4]) + '.')
        rents = [u.rent_min for u in prop.units if u.rent_min and u.rent_min > 0]
        if knowledge and knowledge.avg_rent and rents:
            ratio = abs(sum(rents)/len(rents)-knowledge.avg_rent)/knowledge.avg_rent
            score += max(0, 5*(1-ratio))
            reasons.append('Listed starting rents are ' + ('similar.' if ratio <= .2 else 'different; confirm current pricing.'))
        bedrooms = {u.bedrooms for u in prop.units}
        if knowledge and bedrooms & set(knowledge.bedrooms):
            score += 3
            reasons.append('Overlapping bedroom options in available listings.')
        score += max(0, 5*(1-distance/radius))
        inferred = next((s for s in SEGMENTS if s in candidate_segments and s != 'multifamily'), None)
        if inferred:
            prop.property_type = SEGMENTS.get(inferred, (inferred,))[0]
        row = prop.to_dict()
        row['match'] = {'tier': tier, 'score': round(score, 1), 'distance_miles': round(distance, 2),
                        'subtype': ', '.join(s.replace('_', ' ') for s in sorted(candidate_segments)) or None,
                        'confidence': 'limited', 'reasons': reasons,
                        'gaps': ['Community type and services need verification.' ] + ([] if rents else ['Current pricing is unavailable.']),
                        'source_ids': list(dict.fromkeys(source_ids)), 'context_hash': profile['context_hash']}
        result.append(row)
    result.sort(key=lambda row: ({'primary': 0, 'related': 1, 'broader': 2}[row['match']['tier']], -row['match']['score'], row['match']['distance_miles'], row['name']))
    return result, missing_coordinates
