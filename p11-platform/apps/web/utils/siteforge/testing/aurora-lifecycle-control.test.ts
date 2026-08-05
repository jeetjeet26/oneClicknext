import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertNotAcaciaIdentity,
  assertAuroraMutationPrerequisites,
  assertActiveAuroraLifecycleLease,
  auroraOwnedMetadata,
  inactiveAuroraLeaseFilter,
  isAuroraOwnedMetadata,
  isAuroraBootstrapAnchor,
  requireAuroraLifecycleBearer,
} from './aurora-lifecycle-control'

describe('Aurora lifecycle control guardrails', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('fails closed when disabled or configured with a short secret', () => {
    vi.stubEnv('SITEFORGE_AURORA_LIFECYCLE_CONTROL_ENABLED', 'false')
    expect(() =>
      requireAuroraLifecycleBearer(new Request('http://localhost'))
    ).toThrowError(
      expect.objectContaining({
        code: 'control_disabled',
        statusCode: 404,
      })
    )

    vi.stubEnv('SITEFORGE_AURORA_LIFECYCLE_CONTROL_ENABLED', 'true')
    vi.stubEnv('SITEFORGE_AURORA_LIFECYCLE_CONTROL_SECRET', 'too-short')
    expect(() =>
      requireAuroraLifecycleBearer(new Request('http://localhost'))
    ).toThrowError(
      expect.objectContaining({
        code: 'control_secret_unavailable',
        statusCode: 503,
      })
    )
  })

  it('requires the exact 32+ character bearer secret', () => {
    vi.stubEnv('SITEFORGE_AURORA_LIFECYCLE_CONTROL_ENABLED', 'true')
    vi.stubEnv('SITEFORGE_AURORA_LIFECYCLE_CONTROL_SECRET', 's'.repeat(32))
    expect(() =>
      requireAuroraLifecycleBearer(
        new Request('http://localhost', {
          headers: { authorization: `Bearer ${'x'.repeat(32)}` },
        })
      )
    ).toThrowError(
      expect.objectContaining({
        code: 'invalid_bearer',
        statusCode: 401,
      })
    )
    expect(() =>
      requireAuroraLifecycleBearer(
        new Request('http://localhost', {
          headers: { authorization: `Bearer ${'s'.repeat(32)}` },
        })
      )
    ).not.toThrow()
  })

  it('rejects Acacia and every non-Aurora property identity', () => {
    expect(() =>
      assertNotAcaciaIdentity({
        propertyName: 'Acacia',
        urls: ['https://www.dividendhomes.com/acacia/'],
      })
    ).toThrowError(
      expect.objectContaining({
        code: 'acacia_rejected',
        statusCode: 403,
      })
    )
    expect(() =>
      assertNotAcaciaIdentity({
        propertyName: 'Some Other Property',
        urls: ['https://example.com'],
      })
    ).toThrowError(
      expect.objectContaining({
        code: 'non_aurora_identity',
        statusCode: 409,
      })
    )
    expect(() =>
      assertNotAcaciaIdentity({
        propertyName: 'Aurora',
        urls: ['https://aurora.example.com'],
      })
    ).not.toThrow()
  })

  it('recognizes resources only when owner and run tags both match', () => {
    const metadata = auroraOwnedMetadata({
      ownerId: '55555555-5555-4555-8555-555555555555',
      expiresAt: '2026-08-05T08:00:00.000Z',
      propertyId: '11111111-1111-4111-8111-111111111111',
      websiteId: '22222222-2222-4222-8222-222222222222',
      targetId: '33333333-3333-4333-8333-333333333333',
      rolloutAssignmentId: '44444444-4444-4444-8444-444444444444',
    })
    expect(
      isAuroraOwnedMetadata(
        metadata,
        '55555555-5555-4555-8555-555555555555'
      )
    ).toBe(true)
    expect(
      isAuroraOwnedMetadata(
        { lifecycleOwnerId: '55555555-5555-4555-8555-555555555555' },
        '55555555-5555-4555-8555-555555555555'
      )
    ).toBe(false)
  })

  it('allows only the exact paused contract-1/2 preview as bootstrap anchor', () => {
    expect(
      isAuroraBootstrapAnchor({
        targetType: 'canonical_preview',
        targetRuntimeContractVersion: 1,
        rolloutRequestedContractVersion: 3,
        rolloutStatus: 'paused',
      })
    ).toBe(true)
    expect(
      isAuroraBootstrapAnchor({
        targetType: 'production',
        targetRuntimeContractVersion: 3,
        rolloutRequestedContractVersion: 3,
        rolloutStatus: 'enabled',
      })
    ).toBe(false)
  })

  it('allows failed leases with a null or expired timestamp to be reacquired', () => {
    expect(
      inactiveAuroraLeaseFilter('2026-08-05T16:30:00.000Z')
    ).toBe(
      'lease_expires_at.is.null,lease_expires_at.lte.2026-08-05T16:30:00.000Z'
    )
  })

  it('blocks mutation until baseline, targets, and backup are verified', () => {
    expect(() =>
      assertAuroraMutationPrerequisites({
        rollbackArtifactId: 'rollback',
        startArtifactId: 'start',
      })
    ).toThrowError(
      expect.objectContaining({
        code: 'bootstrap_incomplete',
        statusCode: 409,
      })
    )
    expect(() =>
      assertAuroraMutationPrerequisites({
        rollbackArtifactId: 'rollback',
        rollbackContentHash: 'rollback-hash',
        startArtifactId: 'start',
        startContentHash: 'start-hash',
        stagingTargetId: 'staging',
        productionTargetId: 'production',
        stagingRolloutId: 'staging-rollout',
        productionRolloutId: 'production-rollout',
        backupOperationId: 'backup-operation',
        backupId: 'backup',
        backupVerifiedAt: '2026-08-05T00:00:00.000Z',
      })
    ).not.toThrow()
  })

  it('rejects an unowned mutation while the exclusive lease is active', async () => {
    vi.stubEnv('SITEFORGE_AURORA_LIFECYCLE_CONTROL_ENABLED', 'true')
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      then: (
        resolve: (value: {
          data: Array<{ id: string; lease_expires_at: string }>
          error: null
        }) => unknown
      ) =>
        resolve({
          data: [{
          id: '11111111-1111-4111-8111-111111111111',
          lease_expires_at: '2099-08-05T00:00:00.000Z',
          }],
        error: null,
        }),
    }
    builder.select.mockReturnValue(builder)
    builder.eq.mockReturnValue(builder)
    const client = { from: vi.fn(() => builder) }
    await expect(
      assertActiveAuroraLifecycleLease(
        new Request('http://localhost'),
        { websiteId: '22222222-2222-4222-8222-222222222222' },
        client as never
      )
    ).rejects.toMatchObject({
      code: 'lease_owner_conflict',
      statusCode: 409,
    })
  })
})
