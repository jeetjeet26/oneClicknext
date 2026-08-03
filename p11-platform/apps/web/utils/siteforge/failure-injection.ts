import { createServiceClient } from '@/utils/supabase/admin'

export function siteForgeFailureInjectionEnabled() {
  return (
    process.env.NODE_ENV === 'test' ||
    (process.env.NODE_ENV !== 'production' &&
      process.env.SITEFORGE_ENABLE_FAILURE_INJECTION === '1')
  )
}

export async function consumeSiteForgeFailpoint(input: {
  orgId: string
  failpoint: string
  scopeKey: string
}) {
  if (!siteForgeFailureInjectionEnabled()) return false
  const service = createServiceClient()
  const now = new Date().toISOString()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: injection } = await service
      .from('siteforge_failure_injections')
      .select('id, remaining_hits')
      .eq('org_id', input.orgId)
      .eq('failpoint', input.failpoint)
      .eq('scope_key', input.scopeKey)
      .gt('remaining_hits', 0)
      .gt('expires_at', now)
      .maybeSingle()
    if (!injection) return false
    const { data: consumed } = await service
      .from('siteforge_failure_injections')
      .update({ remaining_hits: injection.remaining_hits - 1 })
      .eq('id', injection.id)
      .eq('remaining_hits', injection.remaining_hits)
      .select('id')
      .maybeSingle()
    if (consumed) return true
  }
  return false
}

export async function throwIfSiteForgeFailpoint(input: {
  orgId: string
  failpoint: string
  scopeKey: string
}) {
  if (await consumeSiteForgeFailpoint(input)) {
    throw new Error(`Injected SiteForge failure: ${input.failpoint}`)
  }
}
