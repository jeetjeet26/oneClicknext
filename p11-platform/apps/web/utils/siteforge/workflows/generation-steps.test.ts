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
  approvedBrief: { objective: 'Generate an approved website.' },
  approvedCreativeDirection: { name: 'Warm editorial' },
  evidenceSnapshot: {
    schemaVersion: 1 as const,
    capturedAt: '2026-07-30T17:00:00.000Z',
    websiteId: '33333333-3333-4333-8333-333333333333',
    propertyId: '44444444-4444-4444-8444-444444444444',
    orgId: '55555555-5555-4555-8555-555555555555',
    plan: {
      id: '11111111-1111-4111-8111-111111111111',
      versionId: '55555555-5555-4555-8555-555555555555',
      revision: 1,
      contentHash: 'a'.repeat(64),
    },
    brief: {
      id: '66666666-6666-4666-8666-666666666666',
      version: 1,
      contentHash: 'b'.repeat(64),
    },
    creativeDirection: {
      setId: '77777777-7777-4777-8777-777777777777',
      setVersion: 1,
      setContentHash: 'c'.repeat(64),
      directionId: '88888888-8888-4888-8888-888888888888',
      directionContentHash: 'd'.repeat(64),
    },
    onboarding: {
      id: '99999999-9999-4999-8999-999999999999',
      contentHash: 'e'.repeat(64),
    },
    brand: {
      assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      contractVersion: '1.0' as const,
      contractHash: 'f'.repeat(64),
    },
    assetManifest: {
      required: true,
      assets: [{
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        role: 'hero',
        fileUrl: 'https://cdn.example.com/hero.jpg',
        contentHash: '1'.repeat(64),
        rightsStatus: 'owned' as const,
        rightsEvidenceHash: '2'.repeat(64),
        approvalStatus: 'approved' as const,
        expiresAt: null,
      }],
      contentHash: '3'.repeat(64),
    },
    inventory: {
      required: false,
      rowCount: 0,
      contentHash: '4'.repeat(64),
      latestSourceUpdatedAt: null,
    },
    contentHash: '5'.repeat(64),
  },
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

  it('produces an explicit reviewable topology diff', async () => {
    const { buildSiteForgeTopologyDiff } = await import('./generation-steps')
    const diff = buildSiteForgeTopologyDiff(
      {
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
                block: 'acf/top-slides',
                required: true,
                factsRequired: [],
                evidenceIds: [],
              },
            ],
          },
        ],
      },
      [
        {
          slug: 'home',
          title: 'Home',
          purpose: 'Welcome prospects',
          sections: [
            {
              id: 'hero',
              type: 'hero',
              acfBlock: 'acf/text-section',
              order: 0,
              reasoning: 'Generated section',
              content: { headline: 'Verified' },
            },
          ],
        },
        {
          slug: 'invented',
          title: 'Invented',
          purpose: 'Unapproved page',
          sections: [],
        },
      ]
    )

    expect(diff.matches).toBe(false)
    expect(diff.changes).toEqual([
      expect.stringContaining('section topology changed: home'),
      'page added: invented',
    ])
    expect(diff).toMatchObject({
      expected: [{ slug: 'home' }],
      actual: [{ slug: 'home' }, { slug: 'invented' }],
    })
  })

  it('fails closed on placeholder copy before publication', async () => {
    const { assertPublishableGeneratedPages } = await import('./generation-steps')

    expect(() =>
      assertPublishableGeneratedPages([
        {
          slug: 'home',
          title: 'Home',
          purpose: 'Welcome prospects',
          sections: [
            {
              id: 'hero',
              type: 'hero',
              acfBlock: 'acf/text-section',
              order: 0,
              reasoning: 'Generated fallback',
              content: {
                content: 'Content for the hero section. Click to edit and customize.',
              },
            },
          ],
        },
      ])
    ).toThrow('non-publishable placeholder copy')
  })

  it('allows evidence-safe fallback content when property evidence is absent', async () => {
    const { assertPublishableGeneratedPages } = await import('./generation-steps')

    expect(() =>
      assertPublishableGeneratedPages([
        {
          slug: 'home',
          title: 'Home',
          purpose: 'Welcome prospects',
          sections: [
            {
              id: 'hero',
              type: 'hero',
              acfBlock: 'acf/text-section',
              order: 0,
              reasoning: 'Evidence-safe fallback',
              evidenceIds: ['siteforge-unverified-content-placeholder-v1'],
              content: {
                content: 'Discover a welcoming place designed around everyday life.',
              },
            },
          ],
        },
      ])
    ).not.toThrow()
  })

  it('resolves the exact approved legal contract from pinned plan evidence', async () => {
    const { resolveApprovedLegalContractForGeneration } = await import(
      './generation-steps'
    )
    const legal = resolveApprovedLegalContractForGeneration(
      {
        onboardingSnapshot: {
          id: '66666666-6666-4666-8666-666666666666',
          contentHash: 'a'.repeat(64),
          enabledCapabilities: [],
        },
      },
      {
        content_hash: 'a'.repeat(64),
        snapshot_payload: approvedOnboardingSnapshot(),
      }
    )

    expect(legal).toMatchObject({
      schemaVersion: 1,
      sourceConfigId: '77777777-7777-4777-8777-777777777777',
      policyBodies: {
        privacyPolicy: 'Exact approved privacy policy.',
        terms: 'Exact approved terms.',
      },
    })
  })

  it('fails early with remediation when pinned legal evidence is unavailable', async () => {
    const { resolveApprovedLegalContractForGeneration } = await import(
      './generation-steps'
    )

    expect(() =>
      resolveApprovedLegalContractForGeneration(
        { onboardingSnapshot: undefined },
        null
      )
    ).toThrow(
      'Complete and approve every Legal section in property onboarding, then reconfirm the SiteForge plan'
    )
    expect(() =>
      resolveApprovedLegalContractForGeneration(
        {
          onboardingSnapshot: {
            id: '66666666-6666-4666-8666-666666666666',
            contentHash: 'a'.repeat(64),
            enabledCapabilities: [],
          },
        },
        {
          content_hash: 'b'.repeat(64),
          snapshot_payload: approvedOnboardingSnapshot(),
        }
      )
    ).toThrow('pinned onboarding legal source is unavailable or changed')
  })

  it('fails early when the pinned snapshot legal body is incomplete', async () => {
    const { resolveApprovedLegalContractForGeneration } = await import(
      './generation-steps'
    )

    expect(() =>
      resolveApprovedLegalContractForGeneration(
        {
          onboardingSnapshot: {
            id: '66666666-6666-4666-8666-666666666666',
            contentHash: 'a'.repeat(64),
            enabledCapabilities: [],
          },
        },
        {
          content_hash: 'a'.repeat(64),
          snapshot_payload: {
            ...approvedOnboardingSnapshot(),
            legal: null,
          },
        }
      )
    ).toThrow('does not contain a complete approved legal contract')
  })

  it('applies approved density and motion preferences to generation design', async () => {
    const { applyApprovedGenerationPreferences } = await import(
      './generation-steps'
    )
    const design = applyApprovedGenerationPreferences(
      {
        colorSystem: {
          primary: '#111111',
          secondary: '#222222',
          accent: '#333333',
          background: '#ffffff',
          strategy: 'brandforge',
          reasoning: 'Approved brand.',
        },
        typography: {
          headingFont: 'Inter',
          headingWeight: 600,
          bodyFont: 'Inter',
          scale: 'balanced',
          strategy: 'brandforge',
          reasoning: 'Approved type.',
        },
        spacing: {
          scale: 'balanced',
          containerMaxWidth: '1200px',
          sectionPadding: '4rem',
          reasoning: 'Approved direction.',
        },
        componentStyles: {
          hero: { layout: 'split', variant: 'split', treatment: 'split', reasoning: 'Approved.' },
          amenityShowcase: { layout: 'grid', variant: 'editorial', treatment: 'mixed', reasoning: 'Approved.' },
          ctaSections: { layout: 'inline', variant: 'inline', treatment: 'button', reasoning: 'Approved.' },
        },
        animations: {
          level: 'subtle',
          types: ['fadeIn'],
          reasoning: 'Approved direction.',
        },
      },
      { contentDensity: 'rich', motion: 'none' }
    )

    expect(design.spacing).toMatchObject({
      scale: 'tight',
      sectionPadding: 'clamp(2.5rem, 5vw, 5rem)',
    })
    expect(design.animations).toMatchObject({ level: 'none', types: [] })
  })

  it('pins published colors and typography to exact BrandForge roles', async () => {
    const { enforcePinnedBrandDesignSystem } = await import(
      './generation-steps'
    )
    const result = enforcePinnedBrandDesignSystem(
      {
        colorSystem: {
          primary: '#F5F1E8',
          secondary: '#C9A962',
          accent: '#F5F1E8',
          background: '#C9A962',
          strategy: 'brandforge',
          reasoning: 'Creative direction remapped the palette.',
        },
        typography: {
          headingFont: 'Montserrat',
          headingWeight: 600,
          bodyFont: 'Montserrat',
          scale: 'balanced',
          strategy: 'brandforge',
          reasoning: 'Creative direction selected utility typography.',
        },
        spacing: {
          scale: 'balanced',
          containerMaxWidth: '1200px',
          sectionPadding: '6rem',
          reasoning: 'Approved direction.',
        },
        componentStyles: {
          hero: {
            layout: 'split',
            variant: 'split',
            treatment: 'split',
            reasoning: 'Approved.',
          },
          amenityShowcase: {
            layout: 'grid',
            variant: 'editorial',
            treatment: 'mixed',
            reasoning: 'Approved.',
          },
          ctaSections: {
            layout: 'inline',
            variant: 'inline',
            treatment: 'button',
            reasoning: 'Approved.',
          },
        },
        animations: {
          level: 'subtle',
          types: ['fadeIn'],
          reasoning: 'Approved direction.',
        },
      },
      {
        logos: {
          variants: [
            {
              role: 'primary',
              url: 'https://cdn.example.com/aurora-logo.svg',
              alt: 'Aurora',
              restrictions: [],
            },
          ],
        },
        positioning: {
          voice: [],
          prohibitedVoice: [],
        },
        colors: {
          roles: [
            { role: 'primary', name: 'Gold', hex: '#C9A962', usage: 'Primary' },
            { role: 'secondary', name: 'Ivory', hex: '#F5F1E8', usage: 'Secondary' },
            { role: 'accent', name: 'Sage', hex: '#7D8B74', usage: 'Accent' },
            { role: 'background', name: 'White', hex: '#FFFFFF', usage: 'Background' },
          ],
        },
        typography: {
          roles: [
            {
              role: 'headline',
              family: 'Cormorant Garamond',
              weights: [500],
              usage: 'Headlines',
            },
            { role: 'body', family: 'Montserrat', weights: [400], usage: 'Body' },
          ],
        },
        photographyYes: {
          description: '',
          criteria: [],
          exampleAssetIds: [],
        },
        photographyNo: {
          description: '',
          criteria: [],
        },
        designElements: {
          elements: [],
          usageNotes: '',
        },
        implementation: {
          lockedRules: [],
        },
      } as never
    )

    expect(result.colorSystem).toMatchObject({
      primary: '#C9A962',
      secondary: '#F5F1E8',
      accent: '#7D8B74',
      background: '#FFFFFF',
    })
    expect(result.typography).toMatchObject({
      headingFont: 'Cormorant Garamond',
      headingWeight: 500,
      bodyFont: 'Montserrat',
    })
  })
})

function approvedOnboardingSnapshot() {
  return {
    legal: {
      id: '77777777-7777-4777-8777-777777777777',
      version: 5,
      status: 'approved',
      approved_at: '2026-08-04T17:00:00.000Z',
      effective_at: '2026-08-04T18:00:00.000Z',
      privacy_policy: { text: 'Exact approved privacy policy.' },
      terms: { text: 'Exact approved terms.' },
      accessibility: { text: 'Exact approved accessibility statement.' },
      fair_housing: {
        text: 'Exact approved Equal Housing Opportunity statement.',
      },
      pricing_disclaimer: { text: 'Exact approved pricing disclaimer.' },
      analytics_consent: { text: 'Exact approved analytics consent.' },
      communications_consent: {
        text: 'Exact approved communications consent.',
      },
    },
  }
}
