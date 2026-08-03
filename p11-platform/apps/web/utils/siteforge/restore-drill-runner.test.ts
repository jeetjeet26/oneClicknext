import { beforeEach, describe, expect, it, vi } from 'vitest'

const { restoreMock, healthMock } = vi.hoisted(() => ({
  restoreMock: vi.fn(),
  healthMock: vi.fn(),
}))

vi.mock('@/utils/siteforge/launch/service', () => ({
  restoreLaunchRelease: restoreMock,
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

  it('executes and verifies a queued automatic restore', async () => {
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
    const setVerifying = resolvedChain({ data: null, error: null })
    const complete = resolvedChain({ data: null, error: null })
    let drillCalls = 0
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'siteforge_restore_drills') {
          drillCalls += 1
          return [load, claim, setVerifying, complete][drillCalls - 1]
        }
        if (table === 'siteforge_launch_releases') {
          return resolvedChain({
            data: {
              state: 'live',
              approved_by: '77777777-7777-4777-8777-777777777777',
              created_by: '88888888-8888-4888-8888-888888888888',
            },
            error: null,
          })
        }
        if (table === 'property_websites') {
          return resolvedChain({
            data: {
              production_artifact_id: drill.expected_artifact_id,
              production_content_hash: drill.expected_content_hash,
              production_url: 'https://example.com',
            },
            error: null,
          })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }
    restoreMock.mockResolvedValue({
      release: { id: drill.release_id },
      manualRequired: false,
    })
    healthMock.mockResolvedValue({
      runId: '99999999-9999-4999-8999-999999999999',
      status: 'healthy',
      checks: {
        identity: { passed: true },
        reachability: { passed: true },
      },
    })

    const result = await processSiteForgeRestoreDrills({}, client as never)

    expect(result).toMatchObject({
      processed: 1,
      succeeded: 1,
      failed: 0,
    })
    expect(restoreMock).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId: drill.release_id,
        actorId: '77777777-7777-4777-8777-777777777777',
      }),
      client
    )
    expect(complete.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'succeeded',
        verification_report: expect.objectContaining({
          identityVerified: true,
          reachabilityVerified: true,
        }),
      })
    )
  })
})
