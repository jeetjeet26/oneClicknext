import copy
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from client_lifecycle import (LocalDatabase, check_policy, digest, export_client,
                              offboard_client, restore_check, verify_export)
from sandbox_workflow import isolated, register

ORG = 'd8886422-4652-47aa-b267-2f511de62220'
FILE = 'b32a9f55-cfe6-4660-9896-65465e8fa751'


class ClientLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name) / 'export'
        self.original = b'Synthetic client original document'
        self.snapshot = {'formatVersion': 1, 'source': 'synthetic_local',
                         'database': 'phase6_client_lifecycle_20260925', 'org': ORG,
                         'rows': [
            {'table': 'public.organizations', 'data': {'id': ORG, 'name': 'Synthetic lifecycle test'}},
            {'table': 'public.knowledge_files', 'data': {'id': FILE, 'org_id': ORG,
             'input': {'byteHash': hashlib.sha256(self.original).hexdigest(), 'size': len(self.original)}}},
            {'table': 'public.integration_credentials', 'data': {'org_id': ORG,
             'settings': {'api_key': 'excluded-api-key', 'nested': [{'refresh_token': 'excluded-token'}]},
             'provider': 'synthetic'}},
        ]}
        self.snapshot['contentHash'] = digest(self.snapshot['rows'])
        self.policy = {'source': 'synthetic_test_policy', 'org': ORG,
                       'sourceHash': self.snapshot['contentHash'], 'holds': [], 'pendingWriters': [],
                       'eligibleAfter': '2000-01-01T00:00:00+00:00', 'mode': 'erase_disposable_clone',
                       'retainedCopies': [{'kind': 'synthetic evidence'}],
                       'providerCopies': 'none_synthetic', 'trainingEligible': False}

    def export(self):
        db = SimpleNamespace(snapshot=lambda org: self.snapshot, require_synthetic=lambda snap: [])
        export_client(db, ORG, self.folder)
        (self.folder / 'originals').mkdir()
        (self.folder / 'originals' / (FILE + '.bin')).write_bytes(self.original)
        self.storage = {'org': ORG, 'sourceHash': self.snapshot['contentHash'],
                        'files': [{'id': FILE, 'exportFile': 'originals/' + FILE + '.bin'}]}
        self.write_storage()

    def write_storage(self):
        (self.folder / 'storage-export.json').write_text(json.dumps(self.storage))

    def receipt(self, org=ORG, state='local_clone_erased'):
        receipt = {'org': org, 'state': state}
        receipt['contentHash'] = digest(receipt)
        return receipt

    def test_export_preserves_original_and_removes_nested_credentials(self):
        self.export()
        self.assertEqual(verify_export(self.folder)['originals'], 1)
        text = (self.folder / 'client-data.json').read_text()
        self.assertNotIn('excluded-api-key', text)
        self.assertNotIn('excluded-token', text)
        self.assertIn('synthetic', text)
        self.assertEqual((self.folder / 'client-data.json').stat().st_mode & 0o777, 0o600)

    def test_reintroduced_credentials_fail_even_with_rehashed_manifest(self):
        self.export()
        data = json.loads((self.folder / 'client-data.json').read_text())
        data[-1]['data']['settings']['api_key'] = 'reintroduced'
        (self.folder / 'client-data.json').write_text(json.dumps(data))
        manifest = json.loads((self.folder / 'manifest.json').read_text())
        manifest['clientDataHash'] = digest(data)
        (self.folder / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'excluded credentials'):
            verify_export(self.folder)

    def test_changed_exported_bytes_fail(self):
        self.export()
        (self.folder / 'originals' / (FILE + '.bin')).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'bytes changed'):
            verify_export(self.folder)

    def test_original_inventory_cannot_be_missing_or_duplicated(self):
        self.export()
        for files in [[], self.storage['files'] * 2]:
            self.storage['files'] = files
            self.write_storage()
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                verify_export(self.folder)

    def test_export_does_not_read_an_unexpected_file_path(self):
        self.export()
        self.storage['files'][0]['exportFile'] = '../outside.bin'
        self.write_storage()
        with self.assertRaisesRegex(ValueError, 'Unexpected'):
            verify_export(self.folder)

    def test_export_identity_is_not_interchangeable(self):
        self.export()
        self.storage['org'] = 'different-client'
        self.write_storage()
        with self.assertRaisesRegex(ValueError, 'another export'):
            verify_export(self.folder)

    def test_hold_active_writer_and_unelapsed_retention_each_block(self):
        check_policy(self.policy, self.snapshot)
        for change in [{'holds': ['owner hold']}, {'pendingWriters': ['worker']},
                       {'eligibleAfter': '2999-01-01T00:00:00+00:00'},
                       {'eligibleAfter': '2000-01-01T00:00:00'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                check_policy({**self.policy, **change}, self.snapshot)

    def test_inventory_and_policy_must_match(self):
        changed = copy.deepcopy(self.snapshot)
        changed['rows'][0]['data']['name'] = 'altered'
        with self.assertRaisesRegex(ValueError, 'contents'):
            check_policy(self.policy, changed)
        changed['contentHash'] = digest(changed['rows'])
        with self.assertRaisesRegex(ValueError, 'inventory'):
            check_policy(self.policy, changed)

    def test_real_provider_training_or_unlisted_retained_copies_block(self):
        for change in [{'providerCopies': 'unverified'}, {'trainingEligible': True},
                       {'retainedCopies': []}, {'source': 'real_client'}, {'org': 'different'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                check_policy({**self.policy, **change}, self.snapshot)

    def test_erased_client_cannot_be_restored(self):
        with self.assertRaisesRegex(ValueError, 'Restore blocked'):
            restore_check(self.snapshot, [self.receipt()])
        self.assertEqual(restore_check(self.snapshot, [self.receipt('other')])['state'], 'no_erasure_match')
        self.assertEqual(restore_check(self.snapshot, [self.receipt(state='rollback_verified')])['state'], 'no_erasure_match')

    def test_changed_erasure_receipt_is_not_accepted(self):
        receipt = self.receipt()
        receipt['org'] = 'other'
        with self.assertRaisesRegex(ValueError, 'receipt changed'):
            restore_check(self.snapshot, [receipt])

    def test_active_console_is_rejected_before_any_native_work(self):
        db = SimpleNamespace(name='postgres')
        with self.assertRaisesRegex(ValueError, 'active console'):
            offboard_client(db, self.snapshot, self.policy, Path(self.temp.name) / 'receipt')
        with self.assertRaisesRegex(ValueError, 'active console'):
            isolated(db)

    def test_remote_or_unregistered_database_names_are_rejected_before_docker(self):
        with patch('client_lifecycle.subprocess.check_output', side_effect=AssertionError('must not invoke Docker')):
            for name in ['production', 'phase6_old_trial', 'postgres; drop database other']:
                with self.subTest(name=name), self.assertRaises(ValueError):
                    LocalDatabase(name)
            with patch.dict('os.environ', {'DOCKER_HOST': 'tcp://remote:2376'}):
                with self.assertRaisesRegex(ValueError, 'local Unix'):
                    LocalDatabase('phase6_client_lifecycle_20260925')

    def test_workflow_registration_refuses_open_ended_scope_and_large_budget(self):
        db = SimpleNamespace(name='phase6_client_lifecycle_20260925')
        for expiry, limit in [('2999-01-01T00:00:00+00:00', 2), ('2000-01-01T00:00:00+00:00', 2),
                              ('2999-01-01T00:00:00+00:00', 3)]:
            with self.subTest(expiry=expiry, limit=limit), self.assertRaises(ValueError):
                register(db, Path(self.temp.name) / 'journal', ORG, ORG, [ORG], [ORG], expiry, limit)


if __name__ == '__main__':
    unittest.main()
