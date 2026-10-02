import copy,json,unittest
from pathlib import Path
from proposals import evaluate,validate_suite,digest,baseline
ROOT=Path(__file__).parent
class ProposalEvaluationTests(unittest.TestCase):
 def setUp(self):
  self.suite=json.loads((ROOT/'fixtures/proposal-suite-v1.json').read_text());self.output=json.loads((ROOT/'fixtures/proposal-fixture-submission-v1.json').read_text());self.h=self.suite['contentHash']
 def test_negative_controls_detect_specific_errors(self):
  r=evaluate(self.suite,self.h,self.output);faults=[x['candidate']['faults']for x in r['rows']]
  for i,f in enumerate(['unsupported_claim','unapproved_action','uncertainty_coverage','stale_source','goal_coverage','invented_authority'],1):self.assertIn(f,faults[i])
  self.assertEqual(sum(x['baseline']['contractPassed']for x in r['rows']),9);self.assertEqual(sum(x['candidate']['contractPassed']for x in r['rows']),3)
  self.assertEqual(r['realModelQuality'],'not_measured');self.assertIsNone(r['reward']);self.assertFalse(r['executionAuthorized']);self.assertFalse(r['trainingEnabled'])
 def test_changed_suite_rejected_even_with_old_label(self):
  self.suite['cases'][0]['product']='changed'
  with self.assertRaisesRegex(ValueError,'changed'):evaluate(self.suite,self.h,self.output)
 def reseal(self):self.suite['contentHash']=digest({k:v for k,v in self.suite.items()if k!='contentHash'});return self.suite['contentHash']
 def test_future_context_rejected(self):
  self.suite['cases'][0]['facts'][0]['availableAt']='2026-09-25T00:00:00Z'
  with self.assertRaisesRegex(ValueError,'Future'):validate_suite(self.suite,self.reseal())
 def test_cross_client_context_rejected(self):
  self.suite['cases'][0]['facts'][0]['clientId']=self.suite['cases'][1]['clientId']
  with self.assertRaisesRegex(ValueError,'cross-client'):validate_suite(self.suite,self.reseal())
 def test_heldout_client_cannot_appear_in_development(self):
  self.suite['cases'][2]['clientId']=self.suite['cases'][0]['clientId']
  with self.assertRaisesRegex(ValueError,'splits'):validate_suite(self.suite,self.reseal())
 def test_production_selection_rejected(self):
  self.suite['source']='production'
  with self.assertRaisesRegex(ValueError,'synthetic'):validate_suite(self.suite,self.reseal())
 def test_subset_and_duplicate_reporting_rejected(self):
  self.output['proposals'].pop()
  with self.assertRaisesRegex(ValueError,'Every frozen case'):evaluate(self.suite,self.h,self.output)
 def test_fixture_cannot_invent_model_usage(self):
  self.output['provenance']['costUsd']=0
  with self.assertRaisesRegex(ValueError,'Fixtures'):evaluate(self.suite,self.h,self.output)
 def test_imported_model_provenance_remains_unverified(self):
  self.output['provenance'].update(kind='imported_model_output',resolvedModel='synthetic-test-model-version',providerReceiptHash='a'*64)
  r=evaluate(self.suite,self.h,self.output);self.assertEqual(r['provenanceVerification'],'imported_unverified');self.assertIsNone(r['provenance']['costUsd']);self.assertFalse(r['executionAuthorized'])
 def test_human_corrections_bound_to_exact_proposal(self):
  item=self.output['proposals'][0];r={'caseId':item['caseId'],'proposalHash':digest(item),'reviewerId':'a'*64,'reviewedAt':'2026-09-24T13:00:00Z','judgment':'needs_correction','correctionCount':2,'reviewSeconds':45,'reasonHash':'b'*64};self.output['reviews']=[r]
  report=evaluate(self.suite,self.h,self.output);self.assertEqual(report['reviews'][item['caseId']]['correctionCount'],2)
  r['proposalHash']='f'*64
  with self.assertRaisesRegex(ValueError,'another proposal'):evaluate(self.suite,self.h,self.output)
if __name__=='__main__':unittest.main()
