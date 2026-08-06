import { describe, expect, it, vi } from 'vitest'
import {
  decideStaleJobOutcome,
  reconcileStaleSiteForgeJobs,
} from './stale-job-reconciler'

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
      attempt_count: 3,
      max_attempts: 3,
      cancel_requested: false,
      updated_at: '2026-07-31T19:05:00.000Z',
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
    expect(load.in).toHaveBeenCalledWith('lifecycle_status', [
      'queued',
      'running',
      'retrying',
    ])
    expect(load.or).toHaveBeenCalledWith(
      expect.stringContaining('heartbeat_at.is.null')
    )
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

  it('terminalizes stale staging projections so the website does not remain deploying', async () => {
    const staleJob = {
      id: '11111111-1111-4111-8111-111111111111',
      org_id: '22222222-2222-4222-8222-222222222222',
      property_id: '33333333-3333-4333-8333-333333333333',
      domain: 'siteforge.deployment',
      subject_id: '44444444-4444-4444-8444-444444444444',
      lifecycle_status: 'running',
      status_reason: 'deploying_release',
      heartbeat_at: '2026-07-31T19:00:00.000Z',
      lease_expires_at: '2026-07-31T19:05:00.000Z',
      attempt_count: 1,
      max_attempts: 3,
      cancel_requested: false,
      updated_at: '2026-07-31T19:05:00.000Z',
      payload: {
        websiteId: '55555555-5555-4555-8555-555555555555',
        deploymentId: '66666666-6666-4666-8666-666666666666',
        targetId: '77777777-7777-4777-8777-777777777777',
      },
    }
    const load = resolvedChain({ data: [staleJob], error: null })
    const jobUpdate = resolvedChain({ data: { id: staleJob.id }, error: null })
    const websiteUpdate = resolvedChain({ data: null, error: null })
    const deploymentUpdate = resolvedChain({ data: null, error: null })
    const targetUpdate = resolvedChain({ data: null, error: null })
    const incident = resolvedChain({ data: null, error: null })
    let sharedJobsCalls = 0
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'shared_jobs') {
          sharedJobsCalls += 1
          return sharedJobsCalls === 1 ? load : jobUpdate
        }
        if (table === 'property_websites') return websiteUpdate
        if (table === 'siteforge_artifact_deployments')
          return deploymentUpdate
        if (table === 'siteforge_wordpress_targets') return targetUpdate
        if (table === 'siteforge_incidents') return incident
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    const result = await reconcileStaleSiteForgeJobs(
      { now: new Date('2026-07-31T20:00:00.000Z') },
      client as never
    )

    expect(result).toMatchObject({ examined: 1, recovered: 1 })
    expect(websiteUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        editor_lifecycle_status: 'approved_for_staging',
        generation_status: 'deploy_failed',
      })
    )
    expect(deploymentUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    )
    expect(targetUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    )
  })

  it('honors retry budgets and cancellation deterministically', () => {
    expect(
      decideStaleJobOutcome({
        cancelRequested: false,
        attemptCount: 0,
        maxAttempts: 3,
      })
    ).toBe('failed')
    expect(
      decideStaleJobOutcome({
        cancelRequested: false,
        attemptCount: 3,
        maxAttempts: 3,
      })
    ).toBe('failed')
    expect(
      decideStaleJobOutcome({
        cancelRequested: true,
        attemptCount: 0,
        maxAttempts: 3,
      })
    ).toBe('cancelled')
    expect(
      decideStaleJobOutcome({
        cancelRequested: false,
        attemptCount: 0,
        maxAttempts: 3,
        publicationClaimed: true,
      })
    ).toBe('failed')
  })
})
