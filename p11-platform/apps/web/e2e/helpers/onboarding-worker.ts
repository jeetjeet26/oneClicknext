import { createHmac, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Exercise the actual worker with a short-lived identity assigned only to this local fixture. */
export async function extractOnboardingFixture(db: SupabaseClient, propertyId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local worker fixture required')
  const user = await db.auth.admin.createUser({ email: `onboarding-worker-${randomUUID()}@p11.test`, password: randomUUID(), email_confirm: true })
  if (user.error || !user.data.user) throw new Error('Could not create the isolated worker fixture')
  const principal = user.data.user.id
  try {
    const grant = await db.from('community_worker_grants').insert({ principal_id: principal, property_id: propertyId, expires_at: new Date(Date.now() + 900_000).toISOString() })
    if (grant.error) throw new Error(grant.error.message)
    // Read the LOCAL signing key in memory; it is never logged or persisted.
    const env: string[] = JSON.parse(execFileSync('docker', ['inspect', 'supabase_auth_p11-platform', '--format', '{{json .Config.Env}}'], { encoding: 'utf8' }))
    const secret = env.find(value => value.startsWith('GOTRUE_JWT_SECRET='))?.slice('GOTRUE_JWT_SECRET='.length)
    if (!secret) throw new Error('Local JWT signing key unavailable')
    const now = Math.floor(Date.now() / 1000)
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: principal, role: 'community_brain_worker', aud: 'authenticated', iss: 'supabase', iat: now, exp: now + 900 })}`
    const token = `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
    const output = execFileSync('../../services/data-engine/.venv/bin/python', ['e2e/helpers/onboarding_worker.py', propertyId], {
      encoding: 'utf8', timeout: 60_000, env: { ...process.env, SUPABASE_URL: url, SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '', COMMUNITY_BRAIN_WORKER_KEY: token, BRAIN_PARSER_SANDBOX_REQUIRED: 'false' },
    })
    const result = JSON.parse(output)
    if (result.state !== 'ready') throw new Error(`Fixture extraction finished as ${result.state}`)
  } finally {
    const removed = await db.from('community_worker_grants').delete().eq('principal_id', principal)
    if (removed.error) throw new Error(removed.error.message)
    const deleted = await db.auth.admin.deleteUser(principal)
    if (deleted.error) throw new Error(deleted.error.message)
  }
}
