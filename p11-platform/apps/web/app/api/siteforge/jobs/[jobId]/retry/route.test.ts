import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  expectJsonError,
  makeJsonRequest,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/test/route-test-helpers'

const {
  authGetUserMock,
  createClientMock,
  createServiceClientMock,
  validatePropertyAccessMock,
  serviceFromMock,
  startWorkflowMock,
  deploymentWorkflowMock,
  generationWorkflowMock,
  loadApprovedGenerationContextMock,
} = vi.hoisted(() => ({
  authGetUserMock: vi.fn(),
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
  serviceFromMock: vi.fn(),
  startWorkflowMock: vi.fn(),
  deploymentWorkflowMock: vi.fn(),
  generationWorkflowMock: vi.fn(),
  loadApprovedGenerationContextMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))
vi.mock('workflow/api', () => ({
  start: startWorkflowMock,
}))
vi.mock('@/workflows/siteforge-generation', () => ({
  siteForgeGenerationWorkflow: generationWorkflowMock,
}))
vi.mock('@/workflows/siteforge-staging-deployment', () => ({
  siteForgeStagingDeploymentWorkflow: deploymentWorkflowMock,
}))
vi.mock('@/utils/siteforge/plans/repository', () => ({
  SiteForgePlanError: class SiteForgePlanError extends Error {
    constructor(
      message: string,
      readonly statusCode: number
    ) {
      super(message)
    }
  },
  loadApprovedSiteForgeGenerationContext: loadApprovedGenerationContextMock,
}))

const jobId = '11111111-1111-4111-8111-111111111111'
const propertyId = '22222222-2222-4222-8222-222222222222'
const orgId = '44444444-4444-4444-8444-444444444444'

function jobQuery(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.in = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue(result)
  return builder
}

describe('SiteForge job retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    createServiceClientMock.mockReturnValue({ from: serviceFromMock })
  })

  it('requires authentication', async () => {
    mockUnauthenticatedUser(authGetUserMock)
    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest(`http://localhost/api/siteforge/jobs/${jobId}/retry`),
      { params: Promise.resolve({ jobId }) }
    )
    await expectJsonError(response, 401, 'Unauthorized')
  })

  it('fails closed when the retry budget is exhausted', async () => {
    mockAuthenticatedUser(authGetUserMock)
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    serviceFromMock.mockReturnValue(
      jobQuery({
        data: {
          id: jobId,
          property_id: propertyId,
          lifecycle_status: 'failed',
          cancel_requested: false,
          attempt_count: 3,
          max_attempts: 3,
          payload: {},
        },
        error: null,
      })
    )

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest(`http://localhost/api/siteforge/jobs/${jobId}/retry`),
      { params: Promise.resolve({ jobId }) }
    )

    await expectJsonError(
      response,
      409,
      'SiteForge job has exhausted its retry limit'
    )
    expect(startWorkflowMock).not.toHaveBeenCalled()
  })

  it('reuses the generic endpoint for failed deployment jobs', async () => {
    mockAuthenticatedUser(authGetUserMock)
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    startWorkflowMock.mockResolvedValue({
      runId: 'deployment-retry-run',
      cancel: vi.fn(),
    })
    const failedJob = jobQuery({
      data: {
        id: jobId,
        domain: 'siteforge.deployment',
        property_id: propertyId,
        lifecycle_status: 'failed',
        cancel_requested: false,
        attempt_count: 1,
        max_attempts: 3,
        error_details: { retryable: true },
        payload: {
          websiteId: '33333333-3333-4333-8333-333333333333',
          propertyId,
          orgId: '44444444-4444-4444-8444-444444444444',
          targetId: '77777777-7777-4777-8777-777777777777',
          deploymentId: '88888888-8888-4888-8888-888888888888',
          artifactId: '55555555-5555-4555-8555-555555555555',
          contentHash: 'a'.repeat(64),
          approvalId: '66666666-6666-4666-8666-666666666666',
          localSimulation: true,
          startedAt: '2026-07-30T18:00:00.000Z',
        },
      },
      error: null,
    })
    const updateBuilder: Record<string, unknown> = {}
    updateBuilder.update = vi.fn(() => updateBuilder)
    updateBuilder.eq = vi.fn(() => updateBuilder)
    updateBuilder.select = vi.fn(() => updateBuilder)
    updateBuilder.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: jobId }, error: null })
    let sharedJobCalls = 0
    serviceFromMock.mockImplementation((table: string) => {
      if (table !== 'shared_jobs') {
        throw new Error(`Unexpected table: ${table}`)
      }
      sharedJobCalls += 1
      return sharedJobCalls === 1 ? failedJob : updateBuilder
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest(`http://localhost/api/siteforge/jobs/${jobId}/retry`),
      { params: Promise.resolve({ jobId }) }
    )

    expect(response.status).toBe(200)
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_status: 'retrying',
        status_reason: 'manual_retry_claimed',
        attempt_count: 2,
      })
    )
    expect(
      vi.mocked(updateBuilder.maybeSingle as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]
    ).toBeLessThan(startWorkflowMock.mock.invocationCallOrder[0])
    expect(startWorkflowMock).toHaveBeenCalledWith(deploymentWorkflowMock, [
      expect.objectContaining({
        sharedJobId: jobId,
        localSimulation: true,
      }),
    ])
  })

  it('reclassifies repaired spacing failures and reconstructs the approved context', async () => {
    mockAuthenticatedUser(authGetUserMock)
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    startWorkflowMock.mockResolvedValue({
      runId: 'generation-retry-run',
      cancel: vi.fn(),
    })
    const websiteId = '33333333-3333-4333-8333-333333333333'
    const planId = '55555555-5555-4555-8555-555555555555'
    const planVersionId = '66666666-6666-4666-8666-666666666666'
    const legacyJobId = '77777777-7777-4777-8777-777777777777'
    const contentHash = 'a'.repeat(64)
    const failedJob = jobQuery({
      data: {
        id: jobId,
        domain: 'siteforge.generation',
        org_id: orgId,
        property_id: propertyId,
        lifecycle_status: 'failed',
        cancel_requested: false,
        attempt_count: 1,
        max_attempts: 3,
        error_message: 'The build stopped.',
        error_details: {
          code: 'generation_failure',
          retryable: false,
          failedCheckpoint: 'publishing_artifact',
          diagnostics: {
            message:
              'Invalid themeJson spacingSizes and designTokens spacing sectionPadding',
          },
        },
        payload: { websiteId, planVersionId, legacyJobId },
      },
      error: null,
    })
    const planVersionQuery = jobQuery({
      data: {
        id: planVersionId,
        plan_id: planId,
        revision: 2,
        content_hash: contentHash,
      },
      error: null,
    })
    const updateBuilder: Record<string, unknown> = {}
    updateBuilder.update = vi.fn(() => updateBuilder)
    updateBuilder.eq = vi.fn(() => updateBuilder)
    updateBuilder.select = vi.fn(() => updateBuilder)
    updateBuilder.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: jobId }, error: null })
    const preferences = {
      style: 'luxury',
      emphasis: 'lifestyle',
      ctaPriority: 'tours',
      referenceSiteUrl: 'https://reference.example.com',
      contentDensity: 'rich',
      motion: 'expressive',
      enabledCapabilities: ['crm', 'tours', 'analytics'],
    }
    const brief = { objective: 'Increase qualified tours', audiences: ['renters'] }
    const creativeDirection = {
      name: 'Warm editorial',
      palette: { primary: '#112233' },
    }
    const evidenceSnapshot = { contentHash: 'b'.repeat(64) }
    loadApprovedGenerationContextMock.mockResolvedValue({
      websiteId,
      propertyId,
      orgId,
      planVersionId,
      plan: {
        summary: 'Approved plan summary',
        recommendations: ['Use grounded leasing copy'],
        preferences,
      },
      brief,
      creativeDirection,
      evidenceSnapshot,
    })
    let sharedJobCalls = 0
    serviceFromMock.mockImplementation((table: string) => {
      if (table === 'siteforge_plan_versions') return planVersionQuery
      if (table !== 'shared_jobs') {
        throw new Error(`Unexpected table: ${table}`)
      }
      sharedJobCalls += 1
      return sharedJobCalls === 1 ? failedJob : updateBuilder
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest(`http://localhost/api/siteforge/jobs/${jobId}/retry`),
      { params: Promise.resolve({ jobId }) }
    )

    expect(response.status).toBe(200)
    expect(loadApprovedGenerationContextMock).toHaveBeenCalledWith(
      { websiteId, planId, confirmedRevision: 2, contentHash },
      expect.objectContaining({ from: serviceFromMock })
    )
    expect(startWorkflowMock).toHaveBeenCalledWith(generationWorkflowMock, [
      expect.objectContaining({
        sharedJobId: jobId,
        legacyJobId,
        websiteId,
        propertyId,
        orgId,
        planVersionId,
        preferences,
        approvedBrief: brief,
        approvedCreativeDirection: creativeDirection,
        evidenceSnapshot,
      }),
    ])
  })

  it('refuses a deterministic nonretryable failure', async () => {
    mockAuthenticatedUser(authGetUserMock)
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    serviceFromMock.mockReturnValue(
      jobQuery({
        data: {
          id: jobId,
          domain: 'siteforge.generation',
          org_id: orgId,
          property_id: propertyId,
          lifecycle_status: 'failed',
          cancel_requested: false,
          attempt_count: 1,
          max_attempts: 3,
          error_details: {
            code: 'asset_evidence_mismatch',
            retryable: false,
            failedCheckpoint: 'executing_photos',
          },
          payload: {},
        },
        error: null,
      })
    )

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest(`http://localhost/api/siteforge/jobs/${jobId}/retry`),
      { params: Promise.resolve({ jobId }) }
    )

    await expectJsonError(
      response,
      409,
      'This failure is not retryable. Review the approved inputs and prepare a new build when the issue is resolved.'
    )
    expect(startWorkflowMock).not.toHaveBeenCalled()
  })
})
