import unittest
from unittest.mock import Mock, patch
from fastapi import HTTPException
from connectors.crm_adapters.base import CreateResult, SearchResult
from jobs.crm_delivery import run_crm_handoff
class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.saved={"state":"claimed","claimId":"claim","kind":"lead","platform":"lasso","credentials":{"api_key":"fixture"},"source":{"email":"fixture@example.invalid"},"payload":{"email":"fixture@example.invalid"},"mapping":{"email":"email"}}
        self.adapter=Mock();self.adapter.get_lead.return_value={"id":"existing-record","email":"fixture@example.invalid"};self.adapter.search_lead.return_value=SearchResult(False);self.adapter.create_lead.return_value=CreateResult(True,external_id='new-record',confirmation='confirmed')
        self.factory=Mock(return_value=self.adapter)
    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'true'})
    @patch('jobs.crm_delivery.rpc')
    def test_paused_delivery_never_claims_or_contacts_provider(self,rpc):
        with self.assertRaises(HTTPException):run_crm_handoff('handoff',self.factory)
        rpc.assert_not_called();self.factory.assert_not_called()
    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_existing_claim_does_not_repeat_provider_call(self,rpc):
        for state in ['searching','sending','confirmed','needs_reconciliation','cancelled','stale']:
            rpc.return_value={'state':state};self.assertEqual(run_crm_handoff('handoff',self.factory),{'state':state})
        self.factory.assert_not_called()
    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_confirmed_existing_match_records_link_without_write(self,rpc):
        rpc.side_effect=[self.saved,{'state':'saved'},{'state':'saved'}]
        self.adapter.search_lead.return_value=SearchResult(True,external_id='existing-record',match_type='email')
        run_crm_handoff('handoff',self.factory)
        self.assertEqual(rpc.call_args.args[1]['p_outcome'],'linked');self.adapter.create_lead.assert_not_called()
    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_failed_search_stops_before_write(self,rpc):
        rpc.side_effect=[self.saved,{'state':'saved'}];self.adapter.search_lead.return_value=SearchResult(False,error='unavailable')
        run_crm_handoff('handoff',self.factory)
        self.assertEqual(rpc.call_args.args[1]['p_outcome'],'failed');self.adapter.create_lead.assert_not_called()
    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_lost_write_intent_acknowledgment_never_sends(self,rpc):
        rpc.side_effect=[self.saved,{'state':'saved'},RuntimeError('database reply lost')]
        with self.assertRaises(RuntimeError):run_crm_handoff('handoff',self.factory)
        self.adapter.create_lead.assert_not_called()
    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_duplicate_intent_reply_never_sends_twice(self,rpc):
        rpc.side_effect=[self.saved,{'state':'saved'},{'state':'sending'}]
        self.assertEqual(run_crm_handoff('handoff',self.factory),{'state':'sending'});self.adapter.create_lead.assert_not_called()
    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_timed_out_create_requires_reconciliation(self,rpc):
        rpc.side_effect=[self.saved,{'state':'saved'},{'state':'write_once'},{'state':'saved'}];self.adapter.create_lead.side_effect=TimeoutError('provider token must not leak')
        run_crm_handoff('handoff',self.factory)
        self.assertEqual(rpc.call_args.args[1]['p_outcome'],'needs_reconciliation');self.adapter.create_lead.assert_called_once()
    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_accepted_and_legacy_success_are_not_confirmed_delivery(self,rpc):
        for confirmation in ['accepted','unverified']:
            rpc.side_effect=[self.saved,{'state':'saved'},{'state':'write_once'},{'state':'saved'}]
            self.adapter.create_lead.return_value=CreateResult(True,external_id='record',confirmation=confirmation)
            run_crm_handoff('handoff',self.factory);self.assertEqual(rpc.call_args.args[1]['p_outcome'],'needs_reconciliation')
    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_lost_final_receipt_does_not_recreate_record(self,rpc):
        rpc.side_effect=[self.saved,{'state':'saved'},{'state':'write_once'},RuntimeError('db reply lost')]
        with self.assertRaises(RuntimeError):run_crm_handoff('handoff',self.factory)
        self.adapter.create_lead.assert_called_once()
    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_note_receipt_binds_destination_and_note_id(self,rpc):
        self.saved.update(kind='note',externalId='existing',payload={'note':'Private saved note'})
        self.adapter.add_note.return_value=CreateResult(True,external_id='note-id',confirmation='confirmed')
        rpc.side_effect=[self.saved,{'state':'write_once'},{'state':'saved'}]
        run_crm_handoff('handoff',self.factory)
        self.assertEqual(rpc.call_args.args[1],{'p_handoff_id':'handoff','p_claim_id':'claim','p_outcome':'note_added','p_external_id':'existing','p_note_id':'note-id'})
        self.adapter.create_lead.assert_not_called();self.adapter.search_lead.assert_not_called()

class DeliveryReadEvidenceTests(DeliveryTests):
    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_search_hit_requires_actual_record_identity_and_contact(self,rpc):
        rpc.side_effect=[self.saved,{'state':'saved'}]
        self.adapter.search_lead.return_value=SearchResult(True,external_id='existing-record',match_type='email')
        self.adapter.get_lead.return_value={'id':'existing-record','email':'other@example.invalid'}
        run_crm_handoff('handoff',self.factory)
        self.assertEqual(rpc.call_args.args[1]['p_outcome'],'failed');self.adapter.create_lead.assert_not_called()


class ExistingLassoDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.saved={"state":"claimed","claimId":"claim","kind":"lead","platform":"lasso","deliveryContract":"existing_lasso","credentials":{"api_key":"synthetic","client_id":"client","project_id":"project"},"payload":{"email":"fixture@example.invalid"},"mapping":{"email":"email"},"source":{"email":"fixture@example.invalid"}}
        self.adapter=Mock();self.adapter.create_lead.return_value=CreateResult(True,external_id='registrant',confirmation='confirmed')
        self.factory=Mock(return_value=self.adapter)

    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_preserved_connection_submits_once_without_inventing_provider_search(self,rpc):
        rpc.side_effect=[self.saved,{'state':'write_once'},{'state':'saved','deliveryState':'confirmed'}]
        self.assertEqual(run_crm_handoff('h',self.factory)['deliveryState'],'confirmed')
        self.adapter.create_lead.assert_called_once_with(self.saved['payload']);self.adapter.search_lead.assert_not_called()
        self.assertEqual([c.args[0] for c in rpc.call_args_list],['claim_crm_handoff','mark_crm_handoff_write','finish_crm_handoff'])
        self.assertEqual(rpc.call_args.args[1]['p_outcome'],'created')

    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_unrecognized_or_unpreserved_registration_connection_never_sends(self,rpc):
        for contract in ['qualified','forged']:
            rpc.side_effect=[{**self.saved,'deliveryContract':contract},{'state':'saved'}]
            run_crm_handoff('h',self.factory)
            self.assertEqual(rpc.call_args.args[1]['p_outcome'],'failed')
        self.factory.assert_not_called()

    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_accepted_or_timed_out_delivery_is_held(self,rpc):
        for result in [CreateResult(True,external_id='registration',confirmation='accepted'),TimeoutError('lost response')]:
            rpc.side_effect=[self.saved,{'state':'write_once'},{'state':'saved'}]
            self.adapter.create_lead.reset_mock(side_effect=True)
            if isinstance(result,Exception):self.adapter.create_lead.side_effect=result
            else:self.adapter.create_lead.return_value=result
            run_crm_handoff('h',self.factory)
            self.adapter.create_lead.assert_called_once();self.assertEqual(rpc.call_args.args[1]['p_outcome'],'needs_reconciliation')

    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_lost_or_replayed_intent_never_writes(self,rpc):
        rpc.side_effect=[self.saved,RuntimeError('lost database acknowledgment')]
        with self.assertRaises(RuntimeError):run_crm_handoff('h',self.factory)
        rpc.side_effect=[self.saved,{'state':'sending'}]
        self.assertEqual(run_crm_handoff('h',self.factory)['state'],'sending');self.adapter.create_lead.assert_not_called()

    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_lost_confirmation_never_repeats_registration(self,rpc):
        rpc.side_effect=[self.saved,{'state':'write_once'},RuntimeError('lost database acknowledgment')]
        with self.assertRaises(RuntimeError):run_crm_handoff('h',self.factory)
        rpc.side_effect=[{'state':'sending'}];run_crm_handoff('h',self.factory)
        self.adapter.create_lead.assert_called_once()

    @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
    @patch('jobs.crm_delivery.rpc')
    def test_existing_registrant_receives_note_without_new_registration(self,rpc):
        rpc.side_effect=[{**self.saved,'kind':'note','externalId':'older-id','payload':{'note':'New saved tour request'}},{'state':'write_once'},{'state':'saved'}]
        self.adapter.add_note.return_value=CreateResult(True,external_id='note-id',confirmation='confirmed')
        run_crm_handoff('h',self.factory)
        self.adapter.add_note.assert_called_once_with('older-id','New saved tour request');self.adapter.create_lead.assert_not_called()
        self.assertEqual(rpc.call_args.args[1]['p_outcome'],'note_added')
