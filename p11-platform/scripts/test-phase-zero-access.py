#!/usr/bin/env python3
"""Test the draft migration in the existing local Supabase DB, always rolling back.

No hosted connection, environment credentials, schema reset, or container changes.
Requires the local supabase_db_p11-platform container and its baseline schema.
"""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'supabase/migrations/20260905190852_phase_zero_access_hardening.sql'
ENGAGEMENT_MIGRATION = ROOT / 'supabase/migrations/20260906014842_phase_zero_engagement_conflict_repair.sql'
TESTS = ROOT / 'supabase/tests/phase_zero_access.test.sql'

# Reproduce the audited hosted-only permissive policy in this rollback-only test.
legacy_policy = '''
drop policy if exists "Service role full access for brand assets" on storage.objects;
create policy "Service role full access for brand assets" on storage.objects
for all to public using (bucket_id = 'brand-assets') with check (bucket_id = 'brand-assets');
'''
sql = 'begin;\nset local statement_timeout = \'30s\';\n'
# Rebuild the draft policy in the transaction, even after local installation.
import re
policy_names = re.findall(r'create policy "([^"]+)"', MIGRATION.read_text(), re.I)
for name in policy_names:
    sql += 'drop policy if exists "' + name.replace('"', '""') + '" on storage.objects;\n'
sql += 'drop index if exists public.lead_engagement_events_property_id_idempotency_key_idx;\n'
sql += legacy_policy + MIGRATION.read_text() + '\n' + ENGAGEMENT_MIGRATION.read_text()
# Restore the final account-aware analytics contract inside the same transaction.
identity = (ROOT / 'supabase/migrations/20260914195328_marketing_fact_account_identity.sql').read_text()
sql += '\n' + identity[identity.index('create or replace function public.query_marketing_analytics('):]
sql += '\n' + TESTS.read_text() + '\nrollback;\n'
try:
    result = subprocess.run(
        ['docker', 'exec', '-i', 'supabase_db_p11-platform', 'psql',
         '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-At'],
        input=sql, text=True, capture_output=True, timeout=60,
    )
except subprocess.TimeoutExpired:
    sys.exit('Local database test timed out; the transaction is not committed.')
lines = result.stdout.splitlines()
for line in lines:
    if line.startswith(('ok ', 'not ok ', '#', '1..')):
        print(line)
if result.returncode:
    print(result.stderr, file=sys.stderr)
if result.returncode or any(line.startswith('not ok ') for line in lines) or 'ROLLBACK' not in lines:
    sys.exit(result.returncode or 1)
print('Local migration and fixtures rolled back. No hosted database was contacted.')
