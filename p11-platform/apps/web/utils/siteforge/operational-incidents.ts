import { createServiceClient } from '@/utils/supabase/admin'
import type { Json } from '@/types/supabase'
import { nextHealthAlertState, recordObject } from './health-alert-state'

/** One active key per website/operation; an uncertain write is never reported as saved. */
export async function recordOperationalIncident(input: {
  websiteId: string; orgId: string; propertyId: string
  operation: 'monitoring' | 'restore'; failed: boolean; observedAt: string
  summary: string; evidence?: Record<string, Json | undefined>
}, service = createServiceClient()) {
  const key = `operation:${input.operation}`
  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await service.from('siteforge_incidents').select('id,severity,evidence,updated_at')
      .eq('website_id', input.websiteId).eq('org_id', input.orgId).eq('dedupe_key', key).neq('status','resolved').maybeSingle()
    if (found.error) throw new Error(`Operational incident could not be read: ${found.error.message}`)
    const existing = found.data
    const priorAt = recordObject(existing?.evidence).observedAt
    if (typeof priorAt === 'string' && priorAt > input.observedAt) return null
    if (!input.failed && !existing) return null
    const updatedAt = new Date().toISOString()
    const values = input.failed ? {
      org_id: input.orgId, property_id: input.propertyId, website_id: input.websiteId,
      dedupe_key: key, severity: 'high', category: `${input.operation}_execution`,
      title: input.operation === 'monitoring' ? 'Website monitoring could not complete' : 'Website restoration needs attention',
      summary: input.summary, updated_at: updatedAt,
      evidence: { ...input.evidence, observedAt: input.observedAt,
        notification: nextHealthAlertState(existing, 'high') } as Json,
    } : { status: 'resolved', resolved_at: updatedAt, updated_at: updatedAt }
    if (existing) {
      const saved = await service.from('siteforge_incidents').update(values).eq('id', existing.id)
        .eq('updated_at', existing.updated_at).neq('status','resolved').select('id').maybeSingle()
      if (saved.error) throw new Error(`Operational incident could not be saved: ${saved.error.message}`)
      if (saved.data) return input.failed ? saved.data.id : null
    } else {
      const saved = await service.from('siteforge_incidents').insert(values as {
        org_id: string; property_id: string; website_id: string; dedupe_key: string
        severity: string; category: string; title: string; summary: string; evidence: Json; updated_at: string
      }).select('id').single()
      if (saved.error?.code === '23505') continue
      if (saved.error || !saved.data) throw new Error(`Operational incident creation was not confirmed: ${saved.error?.message || 'No row'}`)
      return saved.data.id
    }
  }
  throw new Error('Operational incident changed repeatedly; retry after inspecting its current state')
}
