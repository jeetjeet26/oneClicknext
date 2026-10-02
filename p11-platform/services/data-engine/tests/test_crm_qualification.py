import copy
import unittest
from unittest.mock import Mock,patch
from jobs.crm_qualification import run_crm_qualification,CheckpointUnconfirmed
from connectors.crm_adapters.base import CreateResult,SearchResult
class QualificationTests(unittest.TestCase):
 def setUp(self):
  self.payload={'firstname':'OneClick test','lastname':'Qualification test','email':'qualification@example.invalid','company':'Fixture property'}
  self.saved={'state':'claimed','claimId':'claim','platform':'hubspot','credentials':{'api_key':'private-fixture'},'mapping':{'email':'email','first_name':'firstname','last_name':'lastname','property_name':'company'},'source':{'email':'qualification@example.invalid'},'payload':self.payload}
  self.identity={'id':'fixture-account','type':'simulated'};self.receipts={};self.lost=None
  self.adapter=Mock();self.adapter.contract_version='crm-exact-v1';self.adapter.account_identity.return_value=self.identity
  self.adapter.validate_values.return_value=True;self.adapter.search_lead.side_effect=[SearchResult(False),SearchResult(True,external_id='record')]
  self.adapter.create_lead.return_value=CreateResult(True,external_id='record',confirmation='confirmed');self.adapter.get_lead.return_value={**self.payload,'id':'record'}
  self.adapter.record_absent.side_effect=[False,True];self.adapter.delete_lead.return_value=True
  self.factory=Mock(return_value=self.adapter)
 def rpc(self,name,args):
  if name=='claim_crm_qualification':return {**self.saved,'receipts':copy.deepcopy(self.receipts)}
  if name=='finish_crm_qualification':return {'state':'saved'}
  self.assertEqual(name,'checkpoint_crm_qualification');stage=args['p_stage'];result=args['p_result']
  if stage in self.receipts:return {'state':'replayed' if self.receipts[stage]==result else 'request_conflict'}
  self.receipts[stage]=copy.deepcopy(result)
  if self.lost==stage:raise RuntimeError('lost database acknowledgement')
  return {'state':'proceed_once' if stage.endswith('_intent') else 'saved'}
 def run_worker(self):
  with patch('jobs.crm_qualification.rpc',side_effect=self.rpc):return run_crm_qualification('operation',self.factory)
 @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
 def test_full_test_reads_exact_values_and_confirms_cleanup_without_activation(self):
  self.run_worker();self.assertEqual(set(self.receipts),{'preflight','create_intent','created','readback','search','cleanup_intent','cleanup'})
  self.assertTrue(self.receipts['created']['confirmed']);self.assertTrue(self.receipts['cleanup']['absent']);self.adapter.create_lead.assert_called_once_with(self.payload);self.adapter.delete_lead.assert_called_once_with('record')
 @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'true'})
 def test_pause_blocks_test_write_before_intent(self):
  self.run_worker();self.assertNotIn('create_intent',self.receipts);self.adapter.create_lead.assert_not_called();self.adapter.delete_lead.assert_not_called()
 @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
 def test_missing_required_schema_value_stops_before_any_write(self):
  self.adapter.validate_values.side_effect=ValueError('required');self.run_worker();self.assertNotIn('create_intent',self.receipts);self.adapter.create_lead.assert_not_called()
 @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
 def test_existing_test_contact_is_never_deleted_or_overwritten(self):
  self.adapter.search_lead.side_effect=[SearchResult(True,external_id='preexisting')];self.run_worker();self.adapter.create_lead.assert_not_called();self.adapter.delete_lead.assert_not_called()
 @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
 def test_lost_create_intent_acknowledgement_never_creates(self):
  self.lost='create_intent'
  with self.assertRaises(CheckpointUnconfirmed):self.run_worker()
  self.adapter.create_lead.assert_not_called();self.assertNotIn('failure',self.receipts)
 @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
 def test_lost_created_receipt_can_recover_cleanup_without_recreating(self):
  self.lost='created'
  with self.assertRaises(CheckpointUnconfirmed):self.run_worker()
  self.lost=None;self.adapter.search_lead.side_effect=[SearchResult(True,external_id='record')];self.run_worker()
  self.adapter.create_lead.assert_called_once();self.adapter.delete_lead.assert_called_once();self.assertTrue(self.receipts['cleanup']['absent'])
 @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
 def test_uncertain_create_recovers_record_but_does_not_invent_acknowledgement(self):
  self.adapter.create_lead.side_effect=TimeoutError('token must not leak');self.run_worker();self.assertNotIn('created',self.receipts)
  self.adapter.search_lead.side_effect=[SearchResult(True,external_id='record')];self.run_worker()
  self.adapter.create_lead.assert_called_once();self.assertFalse(self.receipts['created']['confirmed']);self.assertTrue(self.receipts['cleanup']['absent']);self.assertNotIn('token must not leak',str(self.receipts))
 @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
 def test_changed_test_values_cannot_be_deleted(self):
  self.adapter.get_lead.return_value={**self.payload,'id':'record','company':'Changed by someone'};self.run_worker();self.adapter.delete_lead.assert_not_called();self.assertNotIn('cleanup_intent',self.receipts)
 @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
 def test_lost_cleanup_intent_does_not_repeat_delete(self):
  self.lost='cleanup_intent'
  with self.assertRaises(CheckpointUnconfirmed):self.run_worker()
  self.adapter.delete_lead.assert_not_called();self.lost=None;self.adapter.record_absent.side_effect=[False];self.run_worker();self.adapter.delete_lead.assert_not_called()
 @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'true'})
 def test_read_only_recovery_can_confirm_absent_record_while_paused(self):
  self.receipts={'preflight':{'identity':self.identity},'create_intent':{},'created':{'externalId':'record','confirmed':True},'cleanup_intent':{'externalId':'record'}};self.adapter.record_absent.side_effect=[True]
  self.run_worker();self.assertTrue(self.receipts['cleanup']['recovered']);self.adapter.delete_lead.assert_not_called();self.adapter.create_lead.assert_not_called()
 @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
 def test_changed_provider_account_stops_recovery(self):
  self.receipts={'preflight':{'identity':{'id':'different'}}};self.run_worker();self.adapter.create_lead.assert_not_called();self.adapter.delete_lead.assert_not_called()
 @patch.dict('os.environ',{'OUTBOUND_DELIVERY_PAUSED':'false'})
 def test_unconfirmed_search_still_cleans_its_confirmed_test_record(self):
  self.adapter.search_lead.side_effect=[SearchResult(False),SearchResult(False,error='search unavailable')];self.run_worker();self.assertFalse(self.receipts['search']['matches']);self.assertTrue(self.receipts['cleanup']['absent'])
