#!/usr/bin/env python3
"""Validate installed local reporting/recovery functions with rollback-only fixtures."""
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[1]
sql = "begin; set local statement_timeout='60s';\n" + (root/'supabase/tests/marketing_import_recovery.test.sql').read_text() + '\nrollback;'
result = subprocess.run(['docker','exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-At'], input=sql, text=True, capture_output=True, timeout=90)
if result.returncode or 'ROLLBACK' not in result.stdout:
    print(result.stderr); raise SystemExit(result.returncode or 1)
print('\n'.join(line for line in result.stdout.splitlines() if line.startswith('PASS:')))
print('Local fixtures rolled back; no hosted connection.')
