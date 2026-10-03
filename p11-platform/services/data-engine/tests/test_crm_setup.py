import unittest
from unittest.mock import Mock, patch
from connectors.crm_adapters.base import ConnectionResult, CRMSchema, CRMField, FieldType
from jobs.crm_setup import run_setup_operation, inspect_configuration
class CRMSetupTests(unittest.TestCase):
    def setUp(self):
        self.saved={"state":"claimed","claimId":"claim","kind":"schema","platform":"lasso","credentials":{"api_key":"private"},"mapping":{"email":"OldEmail"}}
        self.adapter=Mock()
        self.adapter.test_connection.return_value=ConnectionResult(True, api_version="v1")
        self.adapter.get_schema.return_value=CRMSchema('lasso','v1','Registrant','Registrant',[CRMField('email','Email',FieldType.EMAIL,required=True)],evidence_source='provider_response')
        self.factory=Mock(return_value=self.adapter)
    def test_actual_schema_retains_required_fields_and_manual_suggestion_basis(self):
        result=inspect_configuration(self.saved,self.factory)
        self.assertEqual(result['status'],'checked')
        self.assertEqual(result['suggestions'],[{'source':'email','target':'email','basis':'known_field_names'}])
        self.assertEqual(result['mappingIssues']['unknownTargets'],['OldEmail'])
        self.assertEqual(result['mappingIssues']['unmappedRequired'],['email'])
        self.adapter.create_lead.assert_not_called()
        self.adapter.delete_lead.assert_not_called()
    def test_fallback_schema_is_limited(self):
        self.adapter.get_schema.return_value.evidence_source='fallback'
        result=inspect_configuration(self.saved,self.factory)
        self.assertEqual(result['status'],'limited')
        self.assertEqual(result['schema']['evidenceSource'],'fallback')
    def test_public_registration_local_structure_is_not_provider_connection(self):
        self.saved['kind']='connection'
        self.adapter.test_connection.return_value=ConnectionResult(True,api_version='public-registration',evidence_source='local_structure')
        result=inspect_configuration(self.saved,self.factory)
        self.assertEqual(result['status'],'limited')
        self.adapter.get_schema.assert_not_called()
    @patch('jobs.crm_setup.rpc')
    def test_repeated_claim_does_not_make_a_provider_call(self,rpc):
        for state in ['running','completed','failed','stopped','stale']:
            rpc.return_value={'state':state}
            self.assertEqual(run_setup_operation('operation',self.factory),{'state':state})
        self.factory.assert_not_called()
    @patch('jobs.crm_setup.rpc')
    def test_failed_provider_does_not_leak_exception_tokens(self,rpc):
        rpc.side_effect=[self.saved,{'state':'saved'}]
        self.factory.side_effect=RuntimeError('https://provider/?token=private')
        run_setup_operation('operation',self.factory)
        payload=rpc.call_args.args[1]['p_result']
        self.assertEqual(payload,{'status':'failed','messageCode':'provider_check_unconfirmed'})
    @patch('jobs.crm_setup.rpc')
    def test_lost_completion_is_not_treated_as_success(self,rpc):
        rpc.side_effect=[self.saved,RuntimeError('db unavailable')]
        with self.assertRaises(RuntimeError):run_setup_operation('operation',self.factory)
        self.adapter.test_connection.assert_called_once()
    def test_salesforce_rejects_untrusted_instance_before_adapter(self):
        self.saved['platform']='salesforce'
        for url in ['https://localhost','https://org.salesforce.com.evil.invalid','http://org.salesforce.com','https://u:p@org.salesforce.com']:
            self.saved['credentials']['instance_url']=url
            self.assertEqual(inspect_configuration(self.saved,self.factory)['status'],'failed')
        self.factory.assert_not_called()
    def test_schema_field_bound_is_explicit(self):
        self.adapter.get_schema.return_value.fields=[CRMField('field'+str(n),'X',FieldType.STRING) for n in range(501)]
        result=inspect_configuration(self.saved,self.factory)
        self.assertEqual(len(result['schema']['fields']),500)
        self.assertEqual(result['status'],'limited')
        self.assertTrue(result['schema']['truncated'])

class DuplicateCheckTests(unittest.TestCase):
    @patch('routers.crm_integration.get_crm_adapter')
    def test_search_error_is_not_a_confirmed_absence(self,factory):
        import asyncio
        from routers.crm_integration import SearchLeadRequest, search_lead
        from connectors.crm_adapters.base import SearchResult
        factory.return_value.search_lead.return_value=SearchResult(False,error='read unavailable')
        result=asyncio.run(search_lead(SearchLeadRequest(property_id='property',crm_type='lasso',credentials={},email='fixture@example.invalid'),api_key='fixture'))
        self.assertFalse(result['success'])
    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('routers.crm_integration.get_crm_adapter')
    def test_direct_write_path_cannot_bypass_saved_transfer(self,factory):
        import asyncio
        from fastapi import HTTPException
        from routers.crm_integration import PushLeadRequest, push_lead
        request=PushLeadRequest(property_id='property',lead_id='lead',crm_type='lasso',credentials={},lead_data={'phone':'+15555550100'},field_mapping={'phone':'phone'})
        with self.assertRaises(HTTPException) as held:asyncio.run(push_lead(request,api_key='fixture'))
        self.assertEqual(held.exception.status_code,409);factory.assert_not_called()
