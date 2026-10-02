import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import rehearsal
from drift import digest, write_json


class RehearsalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.platform = self.root / 'platform'
        self.base = self.root / 'baseline'
        self.bundle = self.root / 'bundle'
        for p in [self.base, self.bundle/'supabase/migrations', self.platform/'supabase/migrations', self.platform/'supabase/tests']:
            p.mkdir(parents=True)
        history = '20260101000000_history.sql'; pending = '20260102000000_pending.sql'
        self.pending = pending
        files = []
        for name, source, body in [(history, 'production_history', 'select 1;\n'), (pending, 'pending', 'select 2;\n')]:
            path = self.bundle/'supabase/migrations'/name; path.write_text(body)
            files.append({'file': name, 'source': source, 'sha256': rehearsal.sha(path.read_bytes())})
            if source=='pending': (self.platform/'supabase/migrations'/name).write_text(body)
        snapshot={'formatVersion':2,'source':'production','projectRef':rehearsal.PROJECT,'capturedAt':'2026-09-24T00:00:00Z',
                  'catalogQueryHash':'a'*64,'serverVersion':'17.6','objects':[],'migrations':[{'version':history[:14], 'name':'history', 'sqlHash':hashlib.md5(b'select 1;\n').hexdigest(),'statementCount':1}]}
        self.sign_write(self.base/'snapshot.json',snapshot)
        candidate={**snapshot,'source':'local','projectRef':'local:p11-platform:phase6_fixture','migrations':[]}
        self.sign_write(self.base/'expected.json',candidate)
        self.sign_write(self.bundle/'manifest.json',{'projectRef':rehearsal.PROJECT,'productionSnapshotHash':snapshot['contentHash'],'files':files})
        baseline={'formatVersion':1,'scope':'reviewed_schema_only_local_rehearsal','snapshot':'snapshot.json','expectedCandidate':'expected.json','limitations':['Synthetic local runtime only']}
        for key in ['managedArchive','managedList','publicSchema','privateSchema','managedHooks','legacyFixture','legacyCheck']:
            (self.base/(key+'.txt')).write_text('reviewed fixture')
            baseline[key]=key+'.txt'
        baseline['sha256']={k:rehearsal.sha((self.base/baseline[k]).read_bytes()) for k in ['managedArchive','managedList','publicSchema','privateSchema','managedHooks','legacyFixture','legacyCheck','snapshot','expectedCandidate']}
        self.sign_write(self.base/'baseline.json',baseline)
        (self.platform/'supabase/seed.sql').write_text('-- synthetic seed')
        (self.platform/'supabase/tests/eligible.test.sql').write_text("begin; do $$ begin if false then raise exception 'failure'; end if; end $$; rollback;")
        (self.platform/'supabase/tests/reviewflow_responses.test.sql').write_text('DO NOT EXECUTE THIS APPROVAL-BLOCKED FILE')

    def sign_write(self,path,value):
        value.pop('contentHash',None);value['contentHash']=digest(value);write_json(path,value)

    def prepare(self):
        return rehearsal.prepare(self.platform,self.base/'baseline.json',self.bundle)

    def test_prepares_all_inputs_without_executing_sql(self):
        with patch('subprocess.run',side_effect=AssertionError('No execution while preparing')):
            plan=self.prepare();rehearsal.verify_plan(plan)
        self.assertEqual([r['gate'] for r in plan['tests']],['eligible','separate_approval_pending'])
        self.assertNotIn('path',plan['tests'][1]);self.assertFalse(plan['historyWrites'])
        self.assertEqual(plan['wholePhaseAcceptance'],'pending')

    def set_expected_identity(self,identity):
        path=self.base/'expected.json';value=rehearsal.read_json(path);value['projectRef']=identity;self.sign_write(path,value)
        baseline=self.base/'baseline.json';value=rehearsal.read_json(baseline);value['sha256']['expectedCandidate']=rehearsal.sha(path.read_bytes());self.sign_write(baseline,value)

    def test_qualified_phase7_expected_snapshot_supported(self):
        self.set_expected_identity('local:p11-platform:phase7_execution_20260924')
        plan=self.prepare();rehearsal.verify_plan(plan)
        self.assertFalse(plan['productionWrites'])

    def test_active_and_unsupported_expected_snapshots_rejected(self):
        for identity in ['local:p11-platform:postgres','local:p11-platform:phase7_execution_live','local:p11-platform:phase6_;unsafe','local:p11-platform:phase7_execution_20260924_extra']:
            self.set_expected_identity(identity)
            with self.subTest(identity=identity),self.assertRaisesRegex(ValueError,'isolated local rehearsal'):self.prepare()

    def test_changed_pending_file_rejected(self):
        (self.platform/'supabase/migrations'/self.pending).write_text('changed')
        with self.assertRaisesRegex(ValueError,'differs'):self.prepare()

    def test_changed_baseline_input_rejected(self):
        (self.base/'privateSchema.txt').write_text('changed')
        with self.assertRaisesRegex(ValueError,'Baseline input changed'):self.prepare()

    def test_wrong_project_rejected(self):
        path=self.bundle/'manifest.json';value=rehearsal.read_json(path);value['projectRef']='a'*20;self.sign_write(path,value)
        with self.assertRaisesRegex(ValueError,'Wrong production project'):self.prepare()

    def test_duplicate_migration_version_rejected(self):
        path=self.bundle/'manifest.json';value=rehearsal.read_json(path);value['files'].append(value['files'][0]);self.sign_write(path,value)
        with self.assertRaisesRegex(ValueError,'Duplicate'):self.prepare()

    def test_historical_sql_must_match_recorded_production_sql(self):
        path=self.bundle/'supabase/migrations/20260101000000_history.sql';path.write_text('select 99;')
        manifest=self.bundle/'manifest.json';value=rehearsal.read_json(manifest);value['files'][0]['sha256']=rehearsal.sha(path.read_bytes());self.sign_write(manifest,value)
        with self.assertRaisesRegex(ValueError,'Historical SQL'):self.prepare()

    def test_path_escape_and_symlinks_rejected(self):
        with self.assertRaises(ValueError):rehearsal.checked_path(self.base,'../platform/supabase/seed.sql')
        link=self.base/'symlink';link.symlink_to(self.base/'snapshot.json')
        with self.assertRaises(ValueError):rehearsal.checked_path(self.base,'symlink')

    def test_source_changes_after_plan_rejected(self):
        plan=self.prepare();(self.platform/'supabase/seed.sql').write_text('changed')
        with self.assertRaisesRegex(ValueError,'inputs changed'):rehearsal.verify_plan(plan)

    def test_new_suite_after_plan_requires_new_review(self):
        plan=self.prepare();(self.platform/'supabase/tests/new.test.sql').write_text("begin; do $$ begin raise exception 'failure'; end $$; rollback;")
        with self.assertRaisesRegex(ValueError,'inputs changed'):rehearsal.verify_plan(plan)

    def test_edited_gate_does_not_authorize_blocked_test(self):
        plan=self.prepare();plan['tests'][1]['gate']='eligible';plan['contentHash']=digest({k:v for k,v in plan.items() if k!='contentHash'})
        with self.assertRaisesRegex(ValueError,'inputs changed'):rehearsal.verify_plan(plan)

    def test_active_or_injected_database_target_never_executes(self):
        plan=self.prepare()
        for name in ['postgres','phase6_qualified_20260924','phase6_rehearsal_x;drop database postgres;','-h remote']:
            with self.subTest(name=name),patch('subprocess.run',side_effect=AssertionError('Must not contact Docker')):
                with self.assertRaisesRegex(ValueError,'Only a new'):rehearsal.run(plan,name,self.root/'out')

    def test_remote_docker_never_executes(self):
        with patch.dict(os.environ,{'DOCKER_HOST':'tcp://remote:2375'}),patch('subprocess.run',side_effect=AssertionError('Must not contact Docker')):
            with self.assertRaisesRegex(ValueError,'Remote Docker'):rehearsal.run(self.prepare(),'phase6_rehearsal_fixture',self.root/'out')

    def test_previous_evidence_is_never_overwritten(self):
        out=self.root/'out';out.mkdir()
        with patch('subprocess.run',side_effect=AssertionError('Must not contact Docker')):
            with self.assertRaisesRegex(ValueError,'new evidence'):rehearsal.run(self.prepare(),'phase6_rehearsal_fixture',out)

    def test_pgtap_not_ok_is_failure_even_with_zero_exit(self):
        with self.assertRaises(ValueError):rehearsal.check_test_output('1..1\nnot ok 1 - bad\n','pgtap',0)

    def test_pgtap_missing_truncated_duplicate_and_bailout_fail(self):
        for output in ['', '1..2\nok 1\n', '1..2\nok 1\nok 1\n', 'Bail out!\n', '1..1\nok 1\n1..1\n']:
            with self.subTest(output=output),self.assertRaises(ValueError):rehearsal.check_test_output(output,'pgtap',0)

    def test_complete_tap_and_sql_assertions_pass(self):
        rehearsal.check_test_output('ok 1 - first\nok 2 - second\n1..2\n','pgtap',0)
        rehearsal.check_test_output('PASS: checked transaction\n','sql_assertions',0)
        with self.assertRaises(ValueError):rehearsal.check_test_output('','sql_assertions',1)

    def test_empty_assertion_contract_rejected(self):
        (self.platform/'supabase/tests/eligible.test.sql').write_text('begin; select 1; rollback;')
        with self.assertRaisesRegex(ValueError,'assertion contract'):self.prepare()

    def test_test_without_rollback_rejected(self):
        (self.platform/'supabase/tests/eligible.test.sql').write_text("do $$ begin raise exception 'bad'; end $$;")
        with self.assertRaisesRegex(ValueError,'transaction'):self.prepare()

if __name__=='__main__':unittest.main()
