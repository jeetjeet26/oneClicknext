import unittest
from unittest.mock import Mock,patch
import httpx
from connectors.crm_adapters.verified_rest import HubSpotAdapter,SalesforceAdapter

def response(status,data):return httpx.Response(status,json=data)
class VerifiedCRMTests(unittest.TestCase):
 def setUp(self):
  self.hub=HubSpotAdapter({'api_key':'private-fixture-token'})
  self.sf=SalesforceAdapter({'access_token':'private-fixture-token','instance_url':'https://fixture.my.salesforce.com'})
 def test_bad_salesforce_destinations_rejected_before_network(self):
  for url in ['http://org.salesforce.com','https://u:p@org.salesforce.com','https://org.salesforce.com.evil.invalid','https://org.salesforce.com/path','https://org.salesforce.com?x=1']:
   with self.assertRaises(ValueError):SalesforceAdapter({'access_token':'private','instance_url':url})
 @patch('connectors.crm_adapters.verified_rest.request')
 def test_hubspot_phone_only_search_is_real_and_exact(self,request):
  request.return_value=response(200,{'total':1,'results':[{'id':'123','properties':{'phone':'+1 604 555 0100'}}]})
  result=self.hub.search_lead('', '+16045550100')
  self.assertTrue(result.found);self.assertEqual(result.match_type,'phone');self.assertEqual(request.call_args.kwargs['payload']['filterGroups'][0]['filters'][0],{'propertyName':'phone','operator':'EQ','value':'+16045550100'})
 @patch('connectors.crm_adapters.verified_rest.request')
 def test_partial_or_loose_candidates_do_not_authorize_creation(self,request):
  for body in [{'total':2,'results':[{'id':'123','properties':{'email':'x@fixture.invalid'}}]},{'results':[]},{'total':True,'results':[{}]},{'total':1,'results':[{'id':'123','properties':{'phone':'5550100'}}]},{'total':1,'results':[{'id':'../bad','properties':{'phone':'+16045550100'}}]}]:
   request.return_value=response(200,body);r=self.hub.search_lead('', '+16045550100');self.assertTrue(r.error);self.assertFalse(r.found)
 @patch('connectors.crm_adapters.verified_rest.request')
 def test_distinct_email_phone_records_are_held(self,request):
  request.side_effect=[response(200,{'total':1,'results':[{'id':'1','properties':{'email':'x@fixture.invalid'}}]}),response(200,{'total':1,'results':[{'id':'2','properties':{'phone':'+16045550100'}}]})]
  self.assertEqual(self.hub.search_lead('x@fixture.invalid','+16045550100').error,'conflicting_destinations')
 @patch('connectors.crm_adapters.verified_rest.request')
 def test_both_contacts_must_be_checked_even_when_email_matches(self,request):
  request.side_effect=[response(200,{'total':1,'results':[{'id':'1','properties':{'email':'x@fixture.invalid'}}]}),response(503,{})]
  self.assertTrue(self.hub.search_lead('x@fixture.invalid','+16045550100').error);self.assertEqual(request.call_count,2)
 @patch('connectors.crm_adapters.verified_rest.request')
 def test_hubspot_sends_exact_reviewed_values(self,request):
  data={'firstname':'Reviewed','hs_lead_status':'OPEN','lifecyclestage':'opportunity','hs_analytics_source':'REFERRALS'};before=dict(data)
  request.return_value=response(201,{'id':'123'})
  result=self.hub.create_lead(data)
  self.assertEqual(request.call_args.kwargs['payload'],{'properties':before});self.assertEqual(data,before);self.assertEqual(result.confirmation,'confirmed');self.assertEqual(request.call_count,1)
 @patch('connectors.crm_adapters.verified_rest.request')
 def test_salesforce_never_invents_required_values(self,request):
  data={'FirstName':'Reviewed'};request.return_value=response(201,{'success':True,'id':'00Qfixture','errors':[]})
  self.assertEqual(self.sf.create_lead(data).confirmation,'confirmed');self.assertEqual(request.call_args.kwargs['payload'],data);self.assertNotIn('Company',data)
 @patch('connectors.crm_adapters.verified_rest.request')
 def test_create_requires_documented_confirmation_and_id(self,request):
  for adapter in [self.hub,self.sf]:
   for status,data in [(202,{'id':'accepted','success':True,'errors':[]}),(200,{'id':'record','success':True,'errors':[]}),(201,{'success':True}),(201,{'id':'../bad','success':True,'errors':[]})]:
    request.return_value=response(status,data);r=adapter.create_lead({'email':'x@fixture.invalid'});self.assertFalse(r.success);self.assertEqual(r.confirmation,'unverified')
  request.return_value=response(201,{'id':'00Qfixture','success':False,'errors':[]});self.assertFalse(self.sf.create_lead({}).success)
 @patch('connectors.crm_adapters.verified_rest.request')
 def test_provider_error_never_leaks_token(self,request):
  request.side_effect=ValueError('private-fixture-token');self.assertNotIn('private-fixture-token',str(self.hub.create_lead({})));self.assertNotIn('private-fixture-token',str(self.hub.search_lead('x@fixture.invalid')))
 @patch('connectors.crm_adapters.verified_rest.request')
 def test_salesforce_query_escapes_literals_and_does_not_use_substring_match(self,request):
  request.return_value=response(200,{'totalSize':0,'records':[],'done':True})
  r=self.sf.search_lead("x' OR Id != null OR Email = 'x",'+16045550100');self.assertFalse(r.error)
  query=request.call_args_list[0].kwargs['params']['q'];self.assertIn("x\\' OR",query);self.assertNotIn(' LIKE ',request.call_args_list[1].kwargs['params']['q'])
 @patch('connectors.crm_adapters.verified_rest.request')
 def test_salesforce_schema_omits_unwritable_and_defaulted_requirements(self,request):
  request.return_value=response(200,{'createable':True,'fields':[{'name':'Id','createable':False},{'name':'LastName','createable':True,'nillable':False},{'name':'Status','createable':True,'nillable':False,'defaultedOnCreate':True}]})
  schema=self.sf.get_schema();self.assertEqual([f.name for f in schema.fields],['LastName','Status']);self.assertTrue(schema.fields[0].required);self.assertFalse(schema.fields[1].required)
 @patch('connectors.crm_adapters.verified_rest.request')
 def test_cleanup_only_confirms_204_and_rejects_path_injection(self,request):
  for adapter in [self.hub,self.sf]:
   request.reset_mock();self.assertFalse(adapter.delete_lead('../other'));request.assert_not_called()
   for status in [200,202,404,500]:request.return_value=response(status,{});self.assertFalse(adapter.delete_lead('123'))
   request.return_value=response(204,{});self.assertTrue(adapter.delete_lead('123'))
 @patch('connectors.crm_adapters.verified_rest.request')
 def test_archived_contact_not_active_read(self,request):
  request.return_value=response(200,{'id':'123','properties':{'email':'x@fixture.invalid'},'archived':True})
  with self.assertRaises(ValueError):self.hub.get_lead('123')

 @patch('connectors.crm_adapters.verified_rest.request')
 def test_readback_requests_every_approved_custom_field(self,request):
  self.hub.read_fields=['email','custom_community','custom_property']
  request.return_value=response(200,{'id':'123','properties':{'email':'x@fixture.invalid','custom_community':'Reviewed'}})
  self.assertEqual(self.hub.get_lead('123')['custom_community'],'Reviewed')
  self.assertIn('custom_community',request.call_args.kwargs['params']['properties'].split(','))
  self.hub.read_fields=['email&archived=true'];request.reset_mock()
  with self.assertRaises(ValueError):self.hub.get_lead('123')
  request.assert_not_called()
