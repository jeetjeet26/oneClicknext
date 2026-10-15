"""The local browser harness must not inherit production configuration."""
import tempfile
import unittest
from pathlib import Path

from web_community_brain import local_environment


class LocalEnvironmentTests(unittest.TestCase):
    def test_credentials_and_all_next_env_layers_are_isolated(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            web = repo / 'p11-platform/apps/web'
            web.mkdir(parents=True)
            (web / '.env.development.local').write_text('  export PROVIDER_TOKEN=private\nDATABASE_URL=https://production.invalid\n')
            (web / '.env.development').write_text('mixedCaseKey=private\n')
            (web.parents[1] / '.env.local').write_text('DATA_ENGINE_URL=https://production.invalid\n')
            (repo / '.env.local').write_text('OTHER_SECRET=private\n')
            env = local_environment(web, {'anon': 'local-anon', 'service_role': 'local-service'},
                                    'http://127.0.0.1:54321', 'http://127.0.0.1:3001',
                                    {'PATH': '/usr/bin', 'HOME': directory, 'ANTHROPIC_API_KEY': 'private',
                                     'NODE_OPTIONS': '--require=unrelated.js', 'HTTP_PROXY': 'http://remote.invalid'})
            for key in ('PROVIDER_TOKEN', 'DATABASE_URL', 'mixedCaseKey', 'DATA_ENGINE_URL', 'OTHER_SECRET'):
                self.assertEqual(env[key], '')
            for key in ('ANTHROPIC_API_KEY', 'NODE_OPTIONS', 'HTTP_PROXY'):
                self.assertNotIn(key, env)
            self.assertEqual(env['PATH'], '/usr/bin')
            self.assertEqual(env['NEXT_PUBLIC_SUPABASE_URL'], 'http://127.0.0.1:54321')
            self.assertEqual(env['SUPABASE_SERVICE_ROLE_KEY'], 'local-service')
            self.assertEqual(env['OPENAI_API_KEY'], '')

    def test_remote_or_credential_bearing_origins_are_rejected(self):
        for target in ('https://production.supabase.co', 'http://localhost.evil.invalid:3000',
                       'http://user:password@127.0.0.1:3000', 'http://127.0.0.1:3000/remote',
                       'http://127.0.0.1:3000?redirect=remote', 'http://127.0.0.1'):
            with self.subTest(target=target), self.assertRaises(ValueError):
                local_environment(Path('/unused/project/apps/web'), {}, target, 'http://127.0.0.1:3000', {})


if __name__ == '__main__':
    unittest.main()
