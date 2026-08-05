import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceClientMock, fromMock } = vi.hoisted(() => ({
  createServiceClientMock: vi.fn(),
  fromMock: vi.fn(),
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/utils/siteforge/brand-intelligence', () => ({
  getPropertyContext: vi.fn(),
}))
vi.mock('@/utils/siteforge/wordpress-client', () => ({
  deployToWordPress: vi.fn(),
  deployToExistingWordPress: vi.fn(),
}))

const input = {
  sharedJobId: '11111111-1111-4111-8111-111111111111',
  legacyJobId: '22222222-2222-4222-8222-222222222222',
  websiteId: '33333333-3333-4333-8333-333333333333',
  propertyId: '44444444-4444-4444-8444-444444444444',
  artifactId: '55555555-5555-4555-8555-555555555555',
  contentHash: 'a'.repeat(64),
  approvalId: '66666666-6666-4666-8666-666666666666',
  localSimulation: false,
  startedAt: '2026-07-30T18:00:00.000Z',
}

function activeJobQuery(cancelRequested: boolean) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({
    data: {
      lifecycle_status: cancelRequested ? 'cancelled' : 'running',
      cancel_requested: cancelRequested,
      lease_owner: cancelRequested
        ? null
        : `siteforge-deployment:${input.sharedJobId}`,
    },
    error: null,
  })
  return builder
}

describe('SiteForge durable deployment steps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createServiceClientMock.mockReturnValue({ from: fromMock })
  })

  it('continues only while the authoritative deployment job is active', async () => {
    fromMock.mockReturnValue(activeJobQuery(false))
    const { assertSiteForgeDeploymentActive } = await import('./deployment-steps')
    await expect(assertSiteForgeDeploymentActive(input)).resolves.toBeUndefined()
  })

  it('fails permanently before external work after cancellation', async () => {
    fromMock.mockReturnValue(activeJobQuery(true))
    const { assertSiteForgeDeploymentActive } = await import('./deployment-steps')
    await expect(assertSiteForgeDeploymentActive(input)).rejects.toThrow(
      'SiteForge deployment was cancelled'
    )
  })

  it('disables automatic retries for non-idempotent Cloudways provisioning', async () => {
    const { runSiteForgeDeployment } = await import('./deployment-steps')
    expect(runSiteForgeDeployment.maxRetries).toBe(0)
  })
})
