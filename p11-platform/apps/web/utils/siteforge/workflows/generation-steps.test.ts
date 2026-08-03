import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceClientMock, fromMock } = vi.hoisted(() => ({
  createServiceClientMock: vi.fn(),
  fromMock: vi.fn(),
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/siteforge/agents/brand-agent', () => ({
  BrandAgent: class MockBrandAgent {},
}))
vi.mock('@/utils/siteforge/agents/architecture-agent', () => ({
  ArchitectureAgent: class MockArchitectureAgent {},
}))
vi.mock('@/utils/siteforge/agents/design-agent', () => ({
  DesignAgent: class MockDesignAgent {},
}))
vi.mock('@/utils/siteforge/agents/photo-agent', () => ({
  PhotoAgent: class MockPhotoAgent {},
}))
vi.mock('@/utils/siteforge/agents/content-agent', () => ({
  ContentAgent: class MockContentAgent {},
}))
vi.mock('@/utils/siteforge/agents/quality-agent', () => ({
  QualityAgent: class MockQualityAgent {},
}))
vi.mock('@/utils/mcp/wordpress-client', () => ({
  WordPressMcpClient: class MockWordPressMcpClient {},
}))

const input = {
  sharedJobId: '11111111-1111-4111-8111-111111111111',
  legacyJobId: '22222222-2222-4222-8222-222222222222',
  websiteId: '33333333-3333-4333-8333-333333333333',
  propertyId: '44444444-4444-4444-8444-444444444444',
  orgId: '55555555-5555-4555-8555-555555555555',
  planVersionId: '55555555-5555-4555-8555-555555555555',
  preferences: { ctaPriority: 'tours' as const },
  prompt: 'Grounded plan',
  startedAt: '2026-07-30T17:00:00.000Z',
}

function activeJobQuery(cancelRequested: boolean) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({
    data: {
      lifecycle_status: cancelRequested ? 'cancelled' : 'running',
      cancel_requested: cancelRequested,
    },
    error: null,
  })
  return builder
}

describe('SiteForge durable generation steps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createServiceClientMock.mockReturnValue({ from: fromMock })
  })

  it('continues when the shared job is active', async () => {
    fromMock.mockReturnValue(activeJobQuery(false))
    const { assertSiteForgeJobActive } = await import('./generation-steps')
    await expect(assertSiteForgeJobActive(input)).resolves.toBeUndefined()
  })

  it('fails permanently before a step when cancellation was requested', async () => {
    fromMock.mockReturnValue(activeJobQuery(true))
    const { assertSiteForgeJobActive } = await import('./generation-steps')
    await expect(assertSiteForgeJobActive(input)).rejects.toThrow(
      'SiteForge generation was cancelled'
    )
  })

  it('projects page and section identity directly from the confirmed plan', async () => {
    const { architectureFromConfirmedPlan } = await import('./generation-steps')
    const plan = {
      conversionStrategy: { primaryAction: 'tours' as const },
      pages: [
        {
          slug: 'home',
          title: 'Home',
          navLabel: 'Home',
          purpose: 'Welcome prospects',
          sections: [
            {
              id: 'hero',
              label: 'Hero',
              purpose: 'Introduce the property',
              block: 'acf/top-slides' as const,
              required: true,
              factsRequired: [],
              evidenceIds: ['property-1'],
            },
          ],
        },
      ],
    }

    const architecture = architectureFromConfirmedPlan(plan)

    expect(architecture.pages).toEqual([
      expect.objectContaining({
        slug: 'home',
        title: 'Home',
        sections: [
          expect.objectContaining({
            id: 'hero',
            block: 'acf/top-slides',
            order: 0,
          }),
        ],
      }),
    ])
  })
})
