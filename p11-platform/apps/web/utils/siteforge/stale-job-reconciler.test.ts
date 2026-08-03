import { describe, expect, it, vi } from 'vitest'
import { reconcileStaleSiteForgeJobs } from './stale-job-reconciler'

function resolvedChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  for (const method of [
    'select',
    'like',
    'in',
    'or',
    'order',
    'limit',
    'update',
    'eq',
    'insert',
    'maybeSingle',
  ]) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (
    resolve: (value: T) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject)
  return chain
}

describe('stale SiteForge job reconciliation', () => {
  it('terminalizes an expired job and opens an incident', async () => {
    const staleJob = {
      id: '11111111-1111-4111-8111-111111111111',
      org_id: '22222222-2222-4222-8222-222222222222',
      property_id: '33333333-3333-4333-8333-333333333333',
      domain: 'siteforge.generation',
      subject_id: '44444444-4444-4444-8444-444444444444',
      lifecycle_status: 'running',
      heartbeat_at: '2026-07-31T19:00:00.000Z',
      lease_expires_at: '2026-07-31T19:05:00.000Z',
      payload: {},
    }
    const load = resolvedChain({ data: [staleJob], error: null })
    const update = resolvedChain({
      data: { id: staleJob.id },
      error: null,
    })
    const incident = resolvedChain({ data: null, error: null })
    let sharedJobsCalls = 0
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'shared_jobs') {
          sharedJobsCalls += 1
          return sharedJobsCalls === 1 ? load : update
        }
        if (table === 'siteforge_incidents') return incident
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    const result = await reconcileStaleSiteForgeJobs(
      { now: new Date('2026-07-31T20:00:00.000Z') },
      client as never
    )

    expect(result).toMatchObject({ examined: 1, recovered: 1 })
    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_status: 'failed',
        status_reason: 'stale_lease_recovered',
        lease_owner: null,
      })
    )
    expect(incident.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        website_id: staleJob.subject_id,
        dedupe_key: `stale-job:${staleJob.id}`,
        category: 'workflow_stalled',
      })
    )
  })
})
