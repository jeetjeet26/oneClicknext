#!/usr/bin/env python3
"""Verify token protections against local Supabase, then roll back every change.

Uses only fake fixtures; reads no environment credentials and contacts no hosted DB.
"""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'supabase/migrations/20261103232655_protect_integration_credentials_and_ad_links.sql'
TESTS = ROOT / 'supabase/tests/integration_token_access.test.sql'

test_sql = TESTS.read_text()
sql = test_sql.replace('begin;', "begin;\nset local statement_timeout = '30s';\n" + MIGRATION.read_text(), 1)
try:
    result = subprocess.run(
        ['docker', 'exec', '-i', 'supabase_db_p11-platform', 'psql',
         '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-At'],
        input=sql, text=True, capture_output=True, timeout=60,
    )
except subprocess.TimeoutExpired:
    sys.exit('Local database security test timed out; the transaction was not committed.')

lines = result.stdout.splitlines()
for line in lines:
    if line.startswith(('ok ', 'not ok ', '#', '1..')):
        print(line)
if result.returncode:
    print(result.stderr, file=sys.stderr)
if result.returncode or any(line.startswith('not ok ') for line in lines) or 'ROLLBACK' not in lines:
    sys.exit(result.returncode or 1)
print('Local token protections and fake fixtures rolled back. No hosted database was contacted.')
