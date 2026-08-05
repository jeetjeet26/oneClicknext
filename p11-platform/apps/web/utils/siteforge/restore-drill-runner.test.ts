import { beforeEach, describe, expect, it, vi } from 'vitest'

const { healthMock } = vi.hoisted(() => ({
  healthMock: vi.fn(),
}))

vi.mock('@/utils/siteforge/production-health', () => ({
  runSiteForgeHealth: healthMock,
}))

import { processSiteForgeRestoreDrills } from './restore-drill-runner'

function resolvedChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  for (const method of [
    'select',
    'in',
    'order',
    'limit',
    'update',
    'eq',
    'single',
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

describe('SiteForge restore drill runner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('never executes a queued restore and marks it awaiting operator', async () => {
    const drill = {
      id: '11111111-1111-4111-8111-111111111111',
      org_id: '22222222-2222-4222-8222-222222222222',
      property_id: '33333333-3333-4333-8333-333333333333',
      website_id: '44444444-4444-4444-8444-444444444444',
      release_id: '55555555-5555-4555-8555-555555555555',
      expected_artifact_id: '66666666-6666-4666-8666-666666666666',
      expected_content_hash: 'a'.repeat(64),
      status: 'queued',
      started_at: null,
      verification_report: {},
    }
    const load = resolvedChain({ data: [drill], error: null })
    const claim = resolvedChain({ data: { id: drill.id }, error: null })
    let drillCalls = 0
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'siteforge_restore_drills') {
          drillCalls += 1
          return [load, claim][drillCalls - 1]
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    const result = await processSiteForgeRestoreDrills({}, client as never)

    expect(result).toMatchObject({
      processed: 1,
      succeeded: 0,
      failed: 0,
      awaitingOperator: 1,
    })
    expect(claim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        verification_report: expect.objectContaining({
          executionRequiresOperator: true,
          restoreCompleted: false,
        }),
      })
    )
    expect(healthMock).not.toHaveBeenCalled()
  })
})
