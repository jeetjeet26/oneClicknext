from types import SimpleNamespace
from unittest.mock import MagicMock
import pytest
from scrapers.base import ScrapedProperty, ScrapedUnit
from scrapers.knowledge_discovery import DiscoveryKnowledge, KnowledgeSignal, subject_profile, search_terms, rank_candidates, segments, miles


def candidate(name, lat=0.01, lng=0, **kwargs):
    return ScrapedProperty(name=name, address=name+' street', city='City', state='CA', zip_code='12345', latitude=lat, longitude=lng, **kwargs)


def knowledge(kind='senior', text='active adult apartments', **kwargs):
    return DiscoveryKnowledge(property_id='p', context_hash='hash', property_type=kind, signals=[KnowledgeSignal(id='fact:1', text=text)], **kwargs)


def ranked(items, kind='senior', text='active adult apartments', radius=3, existing=None, **kwargs):
    k = knowledge(kind, text, **kwargs)
    subject = {'name': 'Subject', 'property_type': kind}
    profile = subject_profile(subject, k)
    return rank_candidates(items, subject, k, profile, 0, 0, radius, existing or [])[0]


def test_senior_subtype_first_other_senior_related_apartments_retained():
    rows = ranked([candidate('Nearby Apartments'), candidate('Oak Assisted Living'), candidate('Elm Active Adult Apartments')])
    assert [r['match']['tier'] for r in rows] == ['primary', 'related', 'broader']
    assert rows[0]['property_type'] == 'senior'
    assert rows[0]['match']['confidence'] == 'limited'
    assert rows[0]['match']['source_ids'] == ['property:property_type', 'fact:1']


@pytest.mark.parametrize('kind,match', [('student','Student Apartments'),('affordable','Income Restricted Apartments'),('multifamily','Oak Apartments'),('townhome','New Townhomes'),('condo','New Condominiums'),('single_family','Single Family Homes'),('master_planned','Master Planned Community')])
def test_property_categories_prioritize_match_without_exclusion(kind, match):
    rows = ranked([candidate('Unknown Housing'), candidate(match)], kind=kind, text='')
    assert rows[0]['name'] == match
    assert rows[0]['match']['tier'] == 'primary'
    assert len(rows) == 2


def test_unknown_data_is_not_invented_and_negation_is_not_positive():
    assert 'assisted_living' not in segments('Active adult apartments. Not assisted living.')
    rows = ranked([candidate('Oak Grove')])
    assert rows[0]['match']['subtype'] is None
    assert rows[0]['match']['tier'] == 'broader'
    assert 'Current pricing is unavailable.' in rows[0]['match']['gaps']


def test_radius_zero_coordinates_duplicates_subject_and_existing_removed_before_limit():
    rows = ranked([candidate('Subject'), candidate('Already Saved'), candidate('Oak Apartments'), candidate('Oak Apartments'), candidate('Far Apartments', lat=1), candidate('Missing', lat=None), candidate('At Origin', lat=0)], existing=[{'name': 'Already Saved'}])
    assert {r['name'] for r in rows} == {'Oak Apartments','At Origin'}
    assert miles(0,0,0,0) == 0
    assert miles(0,0,None,0) is None


def test_missing_profile_and_subtype_explained():
    assert subject_profile({'name':'Unknown'})['warnings']
    assert subject_profile({'name':'Senior', 'property_type':'senior'})['warnings']
    assert 'apartments for rent' in search_terms(subject_profile({'name':'Senior','property_type':'senior'}))


def test_known_competitor_and_transaction_searches():
    k = knowledge('townhome', 'transaction_model: rental', known_competitors=['Named Community'])
    profile = subject_profile({'name':'Subject'}, k)
    terms = search_terms(profile,k)
    assert 'townhome communities for rent' in terms
    assert 'Named Community' in terms
    assert 'apartments for rent' in terms


def test_no_competitor_observation_becomes_subject_offering():
    k = knowledge('senior', 'Competitor: Assisted Living Home')
    assert subject_profile({'name':'Subject'},k)['segments'] == ['senior']


def test_available_pricing_amenities_and_bedrooms_refine_order():
    good = candidate('Matched Apartments', amenities=['Pool'], units=[ScrapedUnit(unit_type='1br',bedrooms=1,bathrooms=1,rent_min=2000)])
    rows = ranked([candidate('Unknown Apartments'),good], kind='multifamily',text='', amenities=['Pool'],avg_rent=2000,bedrooms=[1])
    assert rows[0]['name'] == 'Matched Apartments'
    assert any('Shared amenities' in reason for reason in rows[0]['match']['reasons'])


def test_google_search_keeps_broad_lane_even_when_direct_lane_fills_limit(monkeypatch):
    from scrapers.google_places import GooglePlacesScraper
    import googlemaps
    calls=[]
    def places(**kwargs):
        calls.append(kwargs['query'])
        prefix='Senior' if 'senior' in kwargs['query'] else 'Broad'
        return {'results':[{'place_id':prefix+str(i),'name':prefix+str(i),'vicinity':'Main St','geometry':{'location':{'lat':0,'lng':0}}} for i in range(20)],'next_page_token':'more'}
    monkeypatch.setattr(googlemaps,'Client',lambda **kwargs: SimpleNamespace(places=places))
    scraper=GooglePlacesScraper.__new__(GooglePlacesScraper);scraper.api_key='fake';scraper.source='google_places'
    rows,warnings=scraper.search_discovery_pool(0,0,3,['senior living','apartments'],pool_limit=10)
    assert len(calls)==2
    assert any(row.name.startswith('Broad') for row in rows)
    assert warnings


def test_google_amenity_search_excludes_standalone_gyms_but_keeps_housing(monkeypatch):
    from scrapers.google_places import GooglePlacesScraper
    import googlemaps
    listings = [('Ladera Oaks Fitness Club', []), ('Local Exercise Studio', ['gym']),
                ('Senior Living Fitness Center', ['gym']), ('Broad Apartments', ['gym']),
                ('The Village Residences', []), ('Unknown Grove', [])]
    def places(**kwargs):
        return {'results': [{'place_id': str(i), 'name': name, 'types': types,
                             'geometry': {'location': {'lat': 0, 'lng': 0}}}
                            for i, (name, types) in enumerate(listings)]}
    monkeypatch.setattr(googlemaps, 'Client', lambda **kwargs: SimpleNamespace(places=places))
    scraper = GooglePlacesScraper.__new__(GooglePlacesScraper)
    scraper.api_key = 'fake'; scraper.source = 'google_places'
    rows, _ = scraper.search_discovery_pool(0, 0, 3, ['communities fitness'])
    assert [row.name for row in rows] == [name for name, _ in listings[2:]]


def test_google_partial_and_total_failures_are_distinct(monkeypatch):
    from scrapers.google_places import GooglePlacesScraper
    import googlemaps
    def places(**kwargs):
        if 'fail' in kwargs['query']: raise RuntimeError('private error')
        return {'results':[]}
    monkeypatch.setattr(googlemaps,'Client',lambda **kwargs: SimpleNamespace(places=places))
    scraper=GooglePlacesScraper.__new__(GooglePlacesScraper);scraper.api_key='fake';scraper.source='google_places'
    rows,warnings=scraper.search_discovery_pool(0,0,3,['fail','success'])
    assert not rows and warnings and 'private error' not in str(warnings)
    with pytest.raises(RuntimeError):scraper.search_discovery_pool(0,0,3,['fail'])


def test_coordinator_keeps_full_pool_for_review_and_never_falls_back_to_city(monkeypatch):
    from scrapers.coordinator import ScrapingCoordinator
    from utils.geocoding import GeocodingService
    from scrapers.google_places import GooglePlacesScraper
    coordinator=ScrapingCoordinator.__new__(ScrapingCoordinator);coordinator.proxy_url=None
    db=MagicMock();coordinator.supabase=db
    def table(name):
        query=MagicMock()
        data={'id':'p','name':'Subject','property_type':'senior','address':{'street':'1 Main','city':'City'}} if name=='properties' else []
        query.select.return_value.eq.return_value.single.return_value.execute.return_value=SimpleNamespace(data=data)
        query.select.return_value.eq.return_value.execute.return_value=SimpleNamespace(data=data)
        return query
    db.table.side_effect=table
    location=SimpleNamespace(latitude=0,longitude=0,city='City',state='CA',is_street_level=True)
    monkeypatch.setattr(GeocodingService,'geocode_address',lambda *args:location)
    monkeypatch.setattr(GooglePlacesScraper,'__init__',lambda self:None)
    monkeypatch.setattr(GooglePlacesScraper,'search_discovery_pool',lambda *args:([candidate('Active Adult '+str(i)) for i in range(12)]+[candidate('Broad Apartments')],[]))
    result=coordinator.discover_competitors_for_property('p',3,10,False,knowledge())
    assert result['success'] and len(result['competitors'])==13
    assert result['competitors'][-1]['match']['tier']=='broader'
    location.is_street_level=False
    assert not coordinator.discover_competitors_for_property('p',3,10,False,knowledge())['success']


def test_profile_property_mismatch_never_searches(monkeypatch):
    from scrapers.coordinator import ScrapingCoordinator
    coordinator=ScrapingCoordinator.__new__(ScrapingCoordinator)
    coordinator.supabase=MagicMock()
    coordinator.supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value=SimpleNamespace(data={'name':'Subject'})
    assert not coordinator.discover_competitors_for_property('other',community_context=knowledge())['success']


def test_conflicting_reviewed_subtype_is_explained_and_takes_priority():
    k=knowledge('senior','community_subtype: Student housing')
    profile=subject_profile({'name':'Subject'},k)
    assert profile['segments']==['student']
    assert any('differs' in warning for warning in profile['warnings'])


def test_care_services_influence_search_and_rank_without_excluding_others():
    k=knowledge('senior','community_subtype: Independent living. care_services: dining and transportation. No nursing.')
    profile=subject_profile({'name':'Subject'},k)
    assert set(profile['services']) == {'dining','transportation'}
    assert any('dining' in term for term in search_terms(profile,k))
    rows=rank_candidates([candidate('Independent Living'),candidate('Independent Living with Dining')],{'name':'Subject'},k,profile,0,0,3,[])[0]
    assert rows[0]['name']=='Independent Living with Dining'
    assert len(rows)==2
