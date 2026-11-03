"""Deterministic provider fixture; exercises real knowledge ranking for browser qualification."""
import json
import sys
from scrapers.base import ScrapedProperty
from scrapers.knowledge_discovery import DiscoveryKnowledge, subject_profile, rank_candidates
request=json.load(sys.stdin)
k=DiscoveryKnowledge(**request['community_context'])
subject={'name':'Discovery browser subject','property_type':'senior'}
profile=subject_profile(subject,k)
names=[f'Active Adult Community {i}' for i in range(12)]+['Related Assisted Living','Broad Apartments','Unknown Grove']
properties=[ScrapedProperty(name=name,address=f'{i+1} Main Street',city='City',state='CA',zip_code='90001',latitude=.01,longitude=0,source='google_places',source_url=f'https://www.google.com/maps/place/?q=place_id:fixture{i}') for i,name in enumerate(names)]
rows,_=rank_candidates(properties,subject,k,profile,0,0,request['radius_miles'],[])
json.dump({'success':True,'data':{'success':True,'property_name':subject['name'],'competitors':rows,'profile':profile,'warnings':['Some provider information is incomplete.']}},sys.stdout)
