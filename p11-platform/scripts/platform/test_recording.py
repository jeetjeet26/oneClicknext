import tempfile,unittest
from pathlib import Path
import recording as r
class RecordingTests(unittest.TestCase):
 def source(self,root,labels,sql_test):
  p=root/'apps/web/utils/actions/catalog.ts';p.parent.mkdir(parents=True);p.write_text('export const ACTION_LABELS='+labels)
  p=root/'supabase/tests/journey.test.sql';p.parent.mkdir(parents=True);p.write_text(sql_test)
 def test_literal_action_traces_native_writer_and_test(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);self.source(root,"{'tour.booked':'Booked tour'}",'select public.book_tour();')
   functions=[{'name':'book_tour','identity':'book_tour()','source':"insert into public.shared_action_events(action) values('tour.booked');"}]
   row=r.generate(root,functions)['actions'][0];self.assertEqual(row['mappingStatus'],'references_found');self.assertTrue(row['testReferences']);self.assertFalse(row['trainingEligible'])
 def test_prefix_recorder_and_caller_are_joined(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);self.source(root,"{'studio.brief.saved':'Saved brief'}",'select public.save_brief();')
   functions=[{'name':'record_studio','identity':'record_studio(text)','source':"insert into public.shared_action_events(action) values('studio.'||p_kind);"},{'name':'save_brief','identity':'save_brief()','source':"perform public.record_studio('brief.saved');"}]
   row=r.generate(root,functions)['actions'][0];self.assertEqual(row['mappingStatus'],'references_found');self.assertEqual(row['nativeRecorders'][0]['identity'],'save_brief()')
 def test_label_and_validator_are_not_capture_proof(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);self.source(root,"{'tour.booked':'Booked tour'}","select 'tour.booked';")
   fn=[{'name':'append_shared_action_event','identity':'append_shared_action_event()','source':"if p_action in('tour.booked') then insert into public.shared_action_events(action)values(p_action);end if;"}]
   self.assertEqual(r.generate(root,fn)['actions'][0]['mappingStatus'],'requires_manual_mapping')
 def test_source_change_invalidates_evidence_version(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);self.source(root,"{'tour.booked':'Booked tour'}",'select public.book_tour();')
   fn=[{'name':'book_tour','identity':'book_tour()','source':"insert into public.shared_action_events(action) values('tour.booked');"}];a=r.generate(root,fn);fn[0]['source']+=' -- correction';b=r.generate(root,fn);self.assertNotEqual(a['contentHash'],b['contentHash'])
 def test_blocked_response_suite_remains_explicit(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);self.source(root,"{'review.response.approved':'Approved response'}",'select public.approve_response();');(root/'supabase/tests/journey.test.sql').rename(root/'supabase/tests/reviewflow_responses.test.sql')
   fn=[{'name':'approve_response','identity':'approve_response()','source':"insert into public.shared_action_events(action) values('review.response.approved');"}];row=r.generate(root,fn)['actions'][0];self.assertEqual(row['testReferences'][0]['executionGate'],'separate_approval_pending')
 def test_isolated_execution_suite_never_becomes_a_general_test(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);self.source(root,"{'agency.execution.advanced':'Advanced rehearsal'}",'select public.operate_agency_execution();');(root/'supabase/rehearsals').mkdir();(root/'supabase/tests/journey.test.sql').rename(root/'supabase/rehearsals/agency_execution.test.sql')
   fn=[{'name':'operate_agency_execution','identity':'operate_agency_execution()','source':"insert into public.shared_action_events(action) values('agency.execution.advanced');"}];row=r.generate(root,fn)['actions'][0];self.assertEqual(row['testReferences'][0]['executionGate'],'isolated_execution_rehearsal_only');self.assertEqual(row['mappingStatus'],'references_found')
if __name__=='__main__':unittest.main()
