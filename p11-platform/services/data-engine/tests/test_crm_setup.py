import unittest
from unittest.mock import Mock, patch
from connectors.crm_adapters.base import ConnectionResult, CRMSchema, CRMField, FieldType
from jobs.crm_setup import run_setup_operation, inspect_configuration
class CRMSetupTests(unittest.TestCase):
    def setUp(self):
        self.ai=patch('jobs.crm_setup.CRMSchemaAgent').start()
        self.addCleanup(patch.stopall)
        self.ai.return_value.discover_and_map.return_value.success=False
        self.saved={"state":"claimed","claimId":"claim","kind":"schema","platform":"lasso","credentials":{"api_key":"private"},"mapping":{"email":"OldEmail"}}
        self.adapter=Mock()
        self.adapter.test_connection.return_value=ConnectionResult(True, api_version="v1")
        self.adapter.get_schema.return_value=CRMSchema('lasso','v1','Registrant','Registrant',[CRMField('email','Email',FieldType.EMAIL,required=True)],evidence_source='provider_response')
        self.factory=Mock(return_value=self.adapter)
    def test_actual_schema_retains_required_fields_and_manual_suggestion_basis(self):
        result=inspect_configuration(self.saved,self.factory)
        self.assertEqual(result['status'],'checked')
        self.assertEqual(result['suggestions'][0]['basis'],'known_field_names')
        self.assertEqual(result['suggestions'][0]['target'],'email')
        self.assertEqual(result['mappingIssues']['unknownTargets'],['OldEmail'])
        self.assertEqual(result['mappingIssues']['unmappedRequired'],['email'])
        self.adapter.create_lead.assert_not_called()
        self.adapter.delete_lead.assert_not_called()
    def test_ai_suggestions_are_schema_scoped(self):
        from jobs.crm_schema_agent import FieldMapping
        answer=self.ai.return_value.discover_and_map.return_value
        answer.success=True
        answer.mappings=[FieldMapping('email','email',94,'Email match',[]),
            FieldMapping('phone','Invented',99,'Invalid',[]),
            FieldMapping('property_name','project_id',60,'Wrong identifier',[]),
            FieldMapping('notes','email',90,'Duplicate',[]),
            FieldMapping('secret','email',90,'Invalid source',[])]
        self.adapter.get_schema.return_value.fields.append(CRMField('project_id','Project ID',FieldType.STRING))
        result=inspect_configuration(self.saved,self.factory)
        self.assertEqual(len(result['suggestions']),1)
        self.assertEqual(result['suggestions'][0]['basis'],'ai')
        self.assertEqual(result['suggestions'][0]['confidence'],94)
        args=self.ai.return_value.discover_and_map.call_args.args
        self.assertNotIn('private',str(args))
        self.assertNotIn('OldEmail',str(args))
        self.adapter.create_lead.assert_not_called()

    def test_ai_reads_text_after_thinking_blocks(self):
        from jobs.crm_schema_agent import CRMSchemaAgent
        from types import SimpleNamespace
        agent=object.__new__(CRMSchemaAgent)
        agent.model='fixture'
        agent.client=Mock()
        agent.client.messages.create.return_value.content=[SimpleNamespace(type='thinking'),SimpleNamespace(type='text',text='{"mappings":[{"tourspark_field":"email","crm_field":"email","confidence":99,"alternatives":[]}]}')]
        answer=agent.discover_and_map('lasso',{'fields':[{'name':'email'}]})
        self.assertTrue(answer.success)
        self.assertEqual(answer.mappings[0].crm_field,'email')

    def test_malformed_model_response_is_not_labelled_as_ai_success(self):
        from jobs.crm_schema_agent import CRMSchemaAgent
        agent=object.__new__(CRMSchemaAgent)
        with self.assertRaises(ValueError):
            agent._parse_mapping_response('not JSON', {})
        self.assertEqual(agent._parse_mapping_response('{"mappings":[null,{"tourspark_field":[],"crm_field":"email"}]}', {}), [])

    def test_ai_failure_preserves_discovered_schema(self):
        self.ai.side_effect=RuntimeError('private')
        result=inspect_configuration(self.saved,self.factory)
        self.assertEqual(result['messageCode'],'ai_mapping_unavailable')
        self.assertEqual(result['schema']['fields'][0]['name'],'email')
        self.assertNotIn('private',str(result))

    def test_fallback_schema_is_limited(self):
        self.adapter.get_schema.return_value.evidence_source='fallback'
        result=inspect_configuration(self.saved,self.factory)
        self.assertEqual(result['status'],'limited')
        self.assertEqual(result['schema']['evidenceSource'],'fallback')
    def test_live_schema_confirms_public_registration_provider_read(self):
        self.adapter.test_connection.return_value=ConnectionResult(True,api_version='public-registration',evidence_source='local_structure')
        self.adapter.get_schema.return_value.evidence_source='provider_plus_defaults'
        result=inspect_configuration(self.saved,self.factory)
        self.assertEqual(result['connection']['evidenceSource'],'provider_response')
        self.assertEqual(result['schema']['evidenceSource'],'provider_plus_defaults')
        self.assertEqual(result['status'],'limited')
        self.adapter.create_lead.assert_not_called()

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
