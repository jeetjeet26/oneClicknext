import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockServerClient,
  expectJsonError,
  makeJsonRequest,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/test/route-test-helpers'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const serviceFromMock = vi.fn()
const serviceRpcMock = vi.fn()
const loadApprovedGenerationContextMock = vi.fn()
const consumeConfirmedPlanMock = vi.fn()
const publishSiteForgeArtifactMock = vi.fn()
const createExecutionBudgetMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/execution-budget', () => ({
  createExecutionBudget: createExecutionBudgetMock,
}))

vi.mock('@/utils/siteforge/agents', () => ({
  SiteForgeOrchestrator: class MockSiteForgeOrchestrator {},
}))

vi.mock('@/workflows/siteforge-generation', () => ({
  siteForgeGenerationWorkflow: vi.fn(),
}))

vi.mock('workflow/api', () => ({
  start: vi.fn(),
}))

vi.mock('@/utils/siteforge/artifacts/repository', () => ({
  publishSiteForgeArtifact: publishSiteForgeArtifactMock,
}))

vi.mock('@/utils/siteforge/plans/repository', () => {
  class MockSiteForgePlanError extends Error {
    constructor(
      message: string,
      readonly statusCode: number
    ) {
      super(message)
    }
  }
  return {
    SiteForgePlanError: MockSiteForgePlanError,
    loadApprovedSiteForgeGenerationContext: loadApprovedGenerationContextMock,
    consumeConfirmedSiteForgePlan: consumeConfirmedPlanMock,
  }
})

const websiteId = '66666666-6666-4666-8666-666666666666'
const planId = '11111111-1111-4111-8111-111111111111'
const planVersionId = '22222222-2222-4222-8222-222222222222'
const propertyId = '33333333-3333-4333-8333-333333333333'
const contentHash = 'a'.repeat(64)

const validRequest = {
  websiteId,
  planId,
  confirmedRevision: 1,
  contentHash,
  idempotencyKey: 'siteforge-generation-1',
}

const evidenceSnapshot = {
  schemaVersion: 1,
  capturedAt: '2026-07-30T17:00:00.000Z',
  websiteId,
  propertyId,
  orgId: '55555555-5555-4555-8555-555555555555',
  plan: {
    id: planId,
    versionId: planVersionId,
    revision: 1,
    contentHash,
  },
  brief: { id: '77777777-7777-4777-8777-777777777777', version: 1, contentHash: 'b'.repeat(64) },
  creativeDirection: {
    setId: '88888888-8888-4888-8888-888888888888',
    setVersion: 1,
    setContentHash: 'c'.repeat(64),
    directionId: '99999999-9999-4999-8999-999999999999',
    directionContentHash: 'd'.repeat(64),
  },
  onboarding: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', contentHash: 'e'.repeat(64) },
  brand: {
    assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    contractVersion: '1.0',
    contractHash: 'f'.repeat(64),
  },
  assetManifest: {
    required: true,
    assets: [{
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      role: 'hero',
      fileUrl: 'https://cdn.example.com/hero.jpg',
      contentHash: '1'.repeat(64),
      rightsStatus: 'owned',
      rightsEvidenceHash: '2'.repeat(64),
      approvalStatus: 'approved',
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
}

const structuredPlan = {
  schemaVersion: 1,
  propertyId,
  name: 'P11 Demo website plan',
  summary: 'A grounded multifamily website.',
  preferences: {
    ctaPriority: 'tours',
    referenceSiteUrl: 'https://reference.example.com',
    contentDensity: 'rich',
    motion: 'expressive',
    enabledCapabilities: ['tours'],
  },
  brandDirection: {
    positioning: 'Verified positioning',
    voice: 'Warm',
    visualDirection: 'Editorial',
    mustInclude: [],
    mustAvoid: [],
  },
  audiences: [],
  pages: [
    {
      slug: 'home',
      title: 'Home',
      navLabel: 'Home',
      purpose: 'Convert prospects.',
      sections: [
        {
          id: 'home-hero',
          label: 'Hero',
          purpose: 'Introduce the property.',
          block: 'acf/top-slides',
          required: true,
          factsRequired: [],
          evidenceIds: ['brand-1'],
        },
      ],
    },
  ],
  conversionStrategy: {
    primaryAction: 'tours',
    secondaryAction: 'contact',
    leadDestination: 'p11_lumaleasing',
    tourDestination: 'p11_lumaleasing',
    requiredForms: ['tour'],
  },
  floorPlanStrategy: {
    source: 'property_units',
    display: 'cards',
    showPricing: true,
    showAvailability: true,
    freshnessHours: 168,
  },
  seoStrategy: {
    localSearchFocus: ['P11 Demo apartments'],
    structuredData: ['ApartmentComplex'],
  },
  analyticsStrategy: {
    enabled: true,
    consentMode: 'required',
    events: ['page_view', 'tour_start'],
  },
  accessibilityRequirements: [],
  legalRequirements: [],
  knownFacts: [{ claim: 'Verified name', evidenceIds: ['brand-1'] }],
  recommendations: [],
  unresolvedQuestions: [],
  evidence: [
    {
      id: 'brand-1',
      sourceType: 'brandforge',
      sourceId: propertyId,
      label: 'Brand book',
      capturedAt: '2026-07-30T17:00:00.000Z',
      confidence: 1,
      retrievalStatus: 'available',
    },
  ],
}

function singleQuery(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.eq = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue(result)
  return builder
}

describe('siteforge generate route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue(
      createMockServerClient(authGetUserMock)
    )
    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
      rpc: serviceRpcMock,
    })
    loadApprovedGenerationContextMock.mockResolvedValue({
      websiteId,
      propertyId,
      orgId: evidenceSnapshot.orgId,
      planVersionId,
      plan: structuredPlan,
      brief: { objective: 'Lease verified apartment homes.' },
      creativeDirection: { name: 'Warm editorial' },
      evidenceSnapshot,
    })
    publishSiteForgeArtifactMock.mockResolvedValue({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      version: 1,
      contentHash: '6'.repeat(64),
    })
    createExecutionBudgetMock.mockResolvedValue({ id: 'budget-1' })
    consumeConfirmedPlanMock.mockResolvedValue(undefined)
  })

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticatedUser(authGetUserMock)

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/siteforge/generate', {
        body: validRequest,
      })
    )

    await expectJsonError(response, 401, 'Unauthorized')
  })

  it('rejects generation without immutable plan identity', async () => {
    mockAuthenticatedUser(authGetUserMock)

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/siteforge/generate', {
        body: { propertyId },
      })
    )

    await expectJsonError(response, 400, 'Invalid generation request')
  })

  it('fails closed when the requested plan is not confirmed', async () => {
    mockAuthenticatedUser(authGetUserMock)
    const { SiteForgePlanError } = await import(
      '@/utils/siteforge/plans/repository'
    )
    loadApprovedGenerationContextMock.mockRejectedValueOnce(
      new SiteForgePlanError(
        'A matching confirmed plan is required for generation',
        409
      )
    )

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/siteforge/generate', {
        body: validRequest,
      })
    )

    await expectJsonError(
      response,
      409,
      'A matching confirmed plan is required for generation'
    )
  })

  it('fails closed when approved rights-cleared generation evidence is missing', async () => {
    mockAuthenticatedUser(authGetUserMock)
    const { SiteForgePlanError } = await import(
      '@/utils/siteforge/plans/repository'
    )
    loadApprovedGenerationContextMock.mockRejectedValueOnce(
      new SiteForgePlanError(
        'Generation requires an approved rights-cleared asset manifest',
        409
      )
    )

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/siteforge/generate', {
        body: validRequest,
      })
    )

    await expectJsonError(
      response,
      409,
      'Generation requires an approved rights-cleared asset manifest'
    )
  })

  it('supports deterministic simulation from a confirmed plan', async () => {
    mockAuthenticatedUser(authGetUserMock)
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const propertyQuery = singleQuery({
      data: {
        id: propertyId,
        name: 'P11 Demo',
        org_id: evidenceSnapshot.orgId,
      },
      error: null,
    })

    const websiteUpdate = vi.fn()
    const websiteUpdateBuilder: Record<string, unknown> = {}
    websiteUpdateBuilder.eq = vi.fn(() => websiteUpdateBuilder)
    websiteUpdateBuilder.select = vi.fn(() => websiteUpdateBuilder)
    websiteUpdateBuilder.single = vi.fn().mockResolvedValue({
      data: { id: websiteId },
      error: null,
    })
    websiteUpdate.mockReturnValue(websiteUpdateBuilder)

    const sharedInsert = vi.fn()
    const sharedInsertBuilder: Record<string, unknown> = {}
    sharedInsertBuilder.select = vi.fn(() => sharedInsertBuilder)
    sharedInsertBuilder.single = vi.fn().mockResolvedValue({
      data: { id: '44444444-4444-4444-8444-444444444444' },
      error: null,
    })
    sharedInsert.mockReturnValue(sharedInsertBuilder)
    const sharedUpdateBuilder: Record<string, unknown> = {}
    sharedUpdateBuilder.eq = vi.fn(() => sharedUpdateBuilder)
    sharedUpdateBuilder.select = vi.fn(() => sharedUpdateBuilder)
    sharedUpdateBuilder.single = vi.fn().mockResolvedValue({
      data: { id: '44444444-4444-4444-8444-444444444444' },
      error: null,
    })
    const assetBuilder: Record<string, unknown> = {}
    assetBuilder.select = vi.fn(() => assetBuilder)
    assetBuilder.eq = vi.fn(() => assetBuilder)
    assetBuilder.order = vi.fn().mockResolvedValue({ data: [], error: null })
    serviceRpcMock.mockResolvedValue({
      data: {
        id: '55555555-5555-4555-8555-555555555555',
        version: 1,
        content_hash: 'b'.repeat(64),
      },
      error: null,
    })

    const planUpdateBuilder: Record<string, unknown> = {}
    planUpdateBuilder.eq = vi.fn(() => planUpdateBuilder)
    planUpdateBuilder.select = vi.fn(() => planUpdateBuilder)
    planUpdateBuilder.single = vi.fn().mockResolvedValue({
      data: { id: planId },
      error: null,
    })

    serviceFromMock.mockImplementation((table: string) => {
      if (table === 'siteforge_plans') {
        return {
          update: vi.fn(() => planUpdateBuilder),
        }
      }
      if (table === 'properties') return propertyQuery
      if (table === 'property_websites') {
        return {
          update: websiteUpdate,
        }
      }
      if (table === 'website_assets') return assetBuilder
      if (table === 'shared_jobs') {
        return {
          insert: sharedInsert,
          update: vi.fn(() => sharedUpdateBuilder),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/siteforge/generate?simulate=1', {
        body: validRequest,
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        websiteId,
        status: 'queued',
        localSimulation: true,
      })
    )
    expect(websiteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        generation_status: 'ready_for_preview',
        user_preferences: structuredPlan.preferences,
        generation_input: expect.objectContaining({
          websiteId,
          planId,
          confirmedRevision: 1,
          contentHash,
          evidenceSnapshot,
        }),
      })
    )
    expect(consumeConfirmedPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        websiteId,
        propertyId,
        orgId: evidenceSnapshot.orgId,
        planId,
        planVersionId,
      }),
      expect.anything()
    )
    // The legacy siteforge_jobs table is read-only compatibility now; the
    // route must not write to it.
    expect(serviceFromMock).not.toHaveBeenCalledWith('siteforge_jobs')
  })

  it('terminalizes an orphan generation job and requires the row update', async () => {
    const builder: Record<string, unknown> = {}
    const update = vi.fn(() => builder)
    builder.eq = vi.fn(() => builder)
    builder.select = vi.fn(() => builder)
    builder.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: '44444444-4444-4444-8444-444444444444' },
      error: null,
    })
    const { terminalizeOrphanGenerationJob } = await import('./route')

    await expect(
      terminalizeOrphanGenerationJob(
        { from: vi.fn(() => ({ update })) } as never,
        '44444444-4444-4444-8444-444444444444',
        'Website insert failed'
      )
    ).resolves.toBeUndefined()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_status: 'failed',
        status_reason: 'website_create_failed',
        error_message: 'Website insert failed',
      })
    )
  })
})
