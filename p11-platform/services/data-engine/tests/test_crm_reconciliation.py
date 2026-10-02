import unittest
from unittest.mock import Mock, patch
from connectors.crm_adapters.base import SearchResult
from jobs.crm_reconciliation import inspect_destination, run_crm_reconciliation

class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.saved={"kind":"lead","platform":"lasso","credentials":{"api_key":"fixture"},"source":{"email":"fixture@example.invalid"},"mapping":{"email":"email"}}
        self.adapter=Mock();self.factory=Mock(return_value=self.adapter)
        self.adapter.search_lead.return_value=SearchResult(True,external_id="record")
        self.adapter.get_lead.return_value={"id":"record","email":"FIXTURE@example.invalid","secret":"must-not-be-saved"}
    def test_read_confirms_exact_contact_without_any_write(self):
        r=inspect_destination(self.saved,self.factory)
        self.assertEqual(r["status"],"match");self.assertFalse(r["originalWriteConfirmed"]);self.assertNotIn("secret",str(r))
        self.adapter.create_lead.assert_not_called();self.adapter.add_note.assert_not_called();self.adapter.delete_lead.assert_not_called()
    def test_unknown_search_and_missing_read_cannot_confirm_destination(self):
        for result in [SearchResult(False,error="private-provider-error"),SearchResult(True)]:
            self.adapter.search_lead.return_value=result
            r=inspect_destination(self.saved,self.factory);self.assertEqual(r["status"],"unconfirmed");self.assertNotIn("private-provider-error",str(r))
    def test_absence_preserves_uncertainty(self):
        self.adapter.search_lead.return_value=SearchResult(False)
        self.assertEqual(inspect_destination(self.saved,self.factory)["status"],"no_match");self.adapter.get_lead.assert_not_called()
    def test_existing_identity_is_read_directly(self):
        self.saved["externalId"]="record"
        self.assertEqual(inspect_destination(self.saved,self.factory)["status"],"match");self.adapter.search_lead.assert_not_called()
    def test_two_contact_destinations_conflict(self):
        self.saved["source"]["phone"]="+1 604 555 0137";self.saved["mapping"]["phone"]="phone"
        self.adapter.search_lead.side_effect=[SearchResult(True,external_id="one"),SearchResult(True,external_id="two")]
        self.assertEqual(inspect_destination(self.saved,self.factory)["reason"],"conflicting_destinations");self.adapter.get_lead.assert_not_called()
    def test_mismatched_record_identity_and_contact_are_not_trusted(self):
        for record in [{"id":"different","email":"fixture@example.invalid"},{"email":"another@example.invalid"},{"name":"No contact"}]:
            self.adapter.get_lead.return_value=record
            self.assertEqual(inspect_destination(self.saved,self.factory)["status"],"unconfirmed")
    def test_verified_email_cannot_hide_conflicting_phone(self):
        self.saved["source"]["phone"]="+16045550137";self.saved["mapping"]["phone"]="phone";self.adapter.get_lead.return_value["phone"]="+16045550999"
        self.assertEqual(inspect_destination(self.saved,self.factory)["reason"],"contact_conflict")
    def test_destination_path_injection_never_reaches_read(self):
        self.adapter.search_lead.return_value=SearchResult(True,external_id="../accounts?token=secret")
        self.assertEqual(inspect_destination(self.saved,self.factory)["status"],"unconfirmed");self.adapter.get_lead.assert_not_called()
    def test_note_or_public_registration_does_not_fabricate_read_capability(self):
        self.saved["kind"]="note";self.assertEqual(inspect_destination(self.saved,self.factory)["status"],"unsupported")
        self.saved["kind"]="lead";self.saved["credentials"]={"client_id":"fixture","project_id":"fixture"};self.assertEqual(inspect_destination(self.saved,self.factory)["status"],"unsupported");self.factory.assert_not_called()
    @patch('jobs.crm_reconciliation.rpc')
    def test_lost_database_acknowledgment_does_not_become_false_provider_evidence(self,rpc):
        rpc.side_effect=[{**self.saved,"state":"claimed","claimId":"claim"},RuntimeError("lost ack")]
        with self.assertRaises(RuntimeError):run_crm_reconciliation("check",self.factory)
        self.assertEqual(rpc.call_count,2);self.assertEqual(rpc.call_args.args[1]["p_result"]["status"],"match")
    @patch('jobs.crm_reconciliation.rpc')
    def test_claim_replay_does_not_repeat_provider_read(self,rpc):
        rpc.return_value={"state":"completed"};self.assertEqual(run_crm_reconciliation("check",self.factory),{"state":"completed"});self.factory.assert_not_called()
    @patch('jobs.crm_reconciliation.rpc')
    def test_provider_errors_are_saved_without_sensitive_details(self,rpc):
        rpc.side_effect=[{**self.saved,"state":"claimed","claimId":"claim"},{"state":"saved"}];self.adapter.get_lead.side_effect=RuntimeError("secret token")
        run_crm_reconciliation("check",self.factory);self.assertEqual(rpc.call_args.args[1]["p_result"],{"status":"unconfirmed","reason":"provider_read_unconfirmed"})
