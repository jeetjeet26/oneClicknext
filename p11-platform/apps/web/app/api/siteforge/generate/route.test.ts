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

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
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

const planId = '11111111-1111-4111-8111-111111111111'
const planVersionId = '22222222-2222-4222-8222-222222222222'
const propertyId = '33333333-3333-4333-8333-333333333333'
const contentHash = 'a'.repeat(64)

const validRequest = {
  planId,
  confirmedRevision: 1,
  contentHash,
  idempotencyKey: 'siteforge-generation-1',
}

const structuredPlan = {
  schemaVersion: 1,
  propertyId,
  name: 'P11 Demo website plan',
  summary: 'A grounded multifamily website.',
  preferences: { ctaPriority: 'tours', motion: 'subtle' },
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
    serviceFromMock.mockReturnValue(
      singleQuery({
        data: {
          id: planId,
          property_id: propertyId,
          status: 'ready_for_review',
          current_revision: 1,
          confirmed_version_id: null,
        },
        error: null,
      })
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

  it('supports deterministic simulation from a confirmed plan', async () => {
    mockAuthenticatedUser(authGetUserMock)
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const planQuery = singleQuery({
      data: {
        id: planId,
        property_id: propertyId,
        status: 'confirmed',
        current_revision: 1,
        confirmed_version_id: planVersionId,
      },
      error: null,
    })
    const planVersionQuery = singleQuery({
      data: {
        id: planVersionId,
        plan: structuredPlan,
        content_hash: contentHash,
      },
      error: null,
    })
    const propertyQuery = singleQuery({
      data: { id: propertyId, name: 'P11 Demo', org_id: 'org-1' },
      error: null,
    })

    const versionsBuilder: Record<string, unknown> = {}
    versionsBuilder.select = vi.fn(() => versionsBuilder)
    versionsBuilder.eq = vi.fn(() => versionsBuilder)
    versionsBuilder.order = vi.fn(() => versionsBuilder)
    versionsBuilder.limit = vi.fn().mockResolvedValue({ data: [], error: null })

    const websiteInsert = vi.fn()
    const websiteBuilder = {
      select: vi.fn(() => versionsBuilder),
      insert: websiteInsert,
    }
    const websiteInsertBuilder: Record<string, unknown> = {}
    websiteInsertBuilder.select = vi.fn(() => websiteInsertBuilder)
    websiteInsertBuilder.single = vi.fn().mockResolvedValue({
      data: { id: 'website-1' },
      error: null,
    })
    websiteInsert.mockReturnValue(websiteInsertBuilder)

    const jobInsert = vi.fn()
    const jobInsertBuilder: Record<string, unknown> = {}
    jobInsertBuilder.select = vi.fn(() => jobInsertBuilder)
    jobInsertBuilder.single = vi.fn().mockResolvedValue({
      data: { id: 'job-1' },
      error: null,
    })

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

    let planCallCount = 0
    serviceFromMock.mockImplementation((table: string) => {
      if (table === 'siteforge_plans') {
        planCallCount += 1
        if (planCallCount === 1) return planQuery
        return {
          update: vi.fn(() => planUpdateBuilder),
        }
      }
      if (table === 'siteforge_plan_versions') return planVersionQuery
      if (table === 'properties') return propertyQuery
      if (table === 'property_websites') return websiteBuilder
      if (table === 'website_assets') return assetBuilder
      if (table === 'siteforge_jobs') {
        return {
          insert: jobInsert.mockReturnValue(jobInsertBuilder),
        }
      }
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
        websiteId: 'website-1',
        status: 'queued',
        localSimulation: true,
      })
    )
    expect(websiteInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        generation_status: 'ready_for_preview',
        generation_input: expect.objectContaining({
          planId,
          confirmedRevision: 1,
          contentHash,
        }),
      })
    )
    expect(jobInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'complete',
        input_params: expect.objectContaining({
          planId,
          localSimulation: true,
        }),
      })
    )
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
