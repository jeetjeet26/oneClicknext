import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export function requireLocalOnboardingSchema() {
  if (!['localhost', '127.0.0.1'].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname)) throw new Error('Onboarding browser tests require an isolated local database')
  execFileSync('docker', ['exec', '-i', 'supabase_db_p11-platform', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], { input: readFileSync('../../supabase/tests/onboarding_schema_preflight.sql'), stdio: ['pipe', 'pipe', 'pipe'] })
}
