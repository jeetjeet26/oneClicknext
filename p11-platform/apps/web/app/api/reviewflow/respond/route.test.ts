import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()

const serviceFromMock = vi.fn()
const loadProfileRoleMock = vi.fn()
const transitionCaseForReviewMock = vi.fn()
const recordSharedApprovalDecisionMock = vi.fn()
const recordSharedOutcomeMock = vi.fn()
const getProviderCapabilitiesMock = vi.fn()
const getProviderDeepLinkMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: serviceFromMock }),
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/reviewflow/access', () => ({
  loadProfileRole: loadProfileRoleMock,
  isManagerRole: (role: string) => role === 'admin' || role === 'manager',
}))

vi.mock('@/utils/reviewflow/cases', () => ({
  transitionCaseForReview: transitionCaseForReviewMock,
}))

vi.mock('@/utils/services/shared-approvals', () => ({
  SharedApprovalError: class SharedApprovalError extends Error {
    statusCode = 409
  },
  recordSharedApprovalDecision: recordSharedApprovalDecisionMock,
}))

vi.mock('@/utils/services/shared-outcomes', () => ({
  recordSharedOutcome: recordSharedOutcomeMock,
}))

vi.mock('@/utils/services/shared-executor', () => ({
  SharedExecutorApprovalRequiredError: class SharedExecutorApprovalRequiredError extends Error {},
  executeExistingSharedJob: vi.fn(async ({ execute }: { execute: () => Promise<unknown> }) => execute()),
  runSharedExecutorJob: vi.fn(),
}))

vi.mock('@/utils/reviewflow/providers', () => ({
  ProviderExecutionError: class ProviderExecutionError extends Error {
    retryable = false
  },
  getProviderCapabilities: getProviderCapabilitiesMock,
  getProviderDeepLink: getProviderDeepLinkMock,
  postGoogleReply: vi.fn(),
  resolveGbpReviewName: vi.fn().mockReturnValue(null),
}))

vi.mock('openai', () => {
  return {
    default: class OpenAI {
      chat = {
        completions: {
          create: vi.fn(),
        },
      }
    },
  }
})

/** Builds a chainable Supabase query mock that resolves to the given result. */
function chainResult(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'update', 'insert', 'delete']) {
    chain[method] = vi.fn(self)
  }
  chain.single = vi.fn().mockResolvedValue(result)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

function mockExistingResponse(row: Record<string, unknown>) {
  const singleMock = vi.fn().mockResolvedValue({ data: row, error: null })
  const eqMock = vi.fn().mockReturnValue({ single: singleMock })
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
  fromMock.mockReturnValue({ select: selectMock })
}

describe('reviewflow respond route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    serviceFromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
    loadProfileRoleMock.mockResolvedValue('admin')
    transitionCaseForReviewMock.mockResolvedValue(undefined)
    getProviderCapabilitiesMock.mockReturnValue({
      ingest: false,
      deepLink: false,
      reply: false,
      verifyReply: false,
      deleteReply: false,
      limitation: 'manual only',
    })
    getProviderDeepLinkMock.mockReturnValue(null)
  })

  it('returns 401 for POST when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'POST',
        body: JSON.stringify({ reviewId: 'review-1' }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 for POST when review property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: { id: 'review-1', property_id: 'property-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'POST',
        body: JSON.stringify({ reviewId: 'review-1' }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 403 for PATCH when response property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    mockExistingResponse({
      id: 'response-1',
      review_id: 'review-1',
      reviews: { property_id: 'property-1' },
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({ responseId: 'response-1', action: 'approve' }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 403 for PATCH when the profile lacks a manager role', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    loadProfileRoleMock.mockResolvedValue('member')

    mockExistingResponse({
      id: 'response-1',
      review_id: 'review-1',
      status: 'draft',
      reviews: { property_id: 'property-1' },
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({ responseId: 'response-1', action: 'approve', decisionReason: 'ok' }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Manager or admin role is required to decide on responses',
    })
  })

  it('returns 400 for PATCH approve without a decision rationale', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    mockExistingResponse({
      id: 'response-1',
      review_id: 'review-1',
      status: 'draft',
      response_text: 'Thanks!',
      shared_action_attempt_id: null,
      reviews: { property_id: 'property-1' },
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({ responseId: 'response-1', action: 'approve' }),
      }) as NextRequest
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'decisionReason is required to approve a response',
    })
  })

  it('returns 400 for PATCH reject without a decision rationale', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    mockExistingResponse({
      id: 'response-1',
      review_id: 'review-1',
      status: 'draft',
      response_text: 'Thanks!',
      shared_action_attempt_id: null,
      reviews: { property_id: 'property-1' },
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({ responseId: 'response-1', action: 'reject' }),
      }) as NextRequest
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'decisionReason is required to reject a response',
    })
  })

  it('returns 409 for PATCH post when the response is not approved', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    mockExistingResponse({
      id: 'response-1',
      review_id: 'review-1',
      status: 'draft',
      shared_action_attempt_id: null,
      reviews: { platform: 'google', property_id: 'property-1' },
    })
    serviceFromMock.mockImplementation(() => chainResult({ data: null, error: null }))

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({ responseId: 'response-1', action: 'post', manualConfirmed: true }),
      }) as NextRequest
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Only approved responses can be posted',
    })
  })

  it('returns 400 for PATCH post when manual confirmation is missing', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    mockExistingResponse({
      id: 'response-1',
      review_id: 'review-1',
      status: 'approved',
      shared_action_attempt_id: null,
      reviews: { platform: 'google', property_id: 'property-1' },
    })
    serviceFromMock.mockImplementation(() => chainResult({ data: null, error: null }))

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({ responseId: 'response-1', action: 'post' }),
      }) as NextRequest
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'manualConfirmed is required to mark a response as posted',
    })
  })

  it('returns 400 for PATCH post when provider evidence is missing', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    mockExistingResponse({
      id: 'response-1',
      review_id: 'review-1',
      status: 'approved',
      shared_action_attempt_id: null,
      reviews: { platform: 'google', property_id: 'property-1' },
    })
    serviceFromMock.mockImplementation(() => chainResult({ data: null, error: null }))

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({ responseId: 'response-1', action: 'post', manualConfirmed: true }),
      }) as NextRequest
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'providerPostId or providerPostUrl is required to confirm provider-side execution',
    })
  })

  it('is idempotent for PATCH post when the response is already posted', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    mockExistingResponse({
      id: 'response-1',
      review_id: 'review-1',
      status: 'posted',
      posting_mode: 'manual_confirmed',
      platform_response_id: 'prov-1',
      provider_post_url: 'https://example.com/post',
      shared_action_attempt_id: null,
      reviews: { platform: 'google', property_id: 'property-1' },
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({ responseId: 'response-1', action: 'post', manualConfirmed: true }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      status: 'posted',
      alreadyPosted: true,
      postingMode: 'manual_confirmed',
    })
    // No writes on the replay path.
    expect(serviceFromMock).not.toHaveBeenCalledWith('review_responses')
  })

  it('records provider evidence on the response row when manually posted', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    mockExistingResponse({
      id: 'response-1',
      review_id: 'review-1',
      status: 'approved',
      response_text: 'Thanks for your feedback.',
      shared_action_attempt_id: null,
      reviews: { platform: 'google', property_id: 'property-1' },
    })

    const responseUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    const responseUpdate = vi.fn().mockReturnValue({ eq: responseUpdateEq })
    const reviewsUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    const reviewsUpdate = vi.fn().mockReturnValue({ eq: reviewsUpdateEq })

    serviceFromMock.mockImplementation((table: string) => {
      if (table === 'review_platform_connections') {
        return chainResult({ data: null, error: null })
      }
      if (table === 'review_responses') {
        return { update: responseUpdate }
      }
      if (table === 'reviews') {
        return { update: reviewsUpdate }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({
          responseId: 'response-1',
          action: 'post',
          manualConfirmed: true,
          providerPostUrl: 'https://maps.google.com/review/reply/123',
        }),
      }) as NextRequest
    )

    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      status: 'posted',
      postingMode: 'manual_confirmed',
      providerEvidence: {
        providerPostUrl: 'https://maps.google.com/review/reply/123',
      },
    })

    // Evidence lands on the response row itself (no audit tickets).
    expect(responseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'posted',
        posting_mode: 'manual_confirmed',
        provider_post_url: 'https://maps.google.com/review/reply/123',
        posted_by: 'user-1',
      })
    )
    expect(reviewsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ response_status: 'posted' })
    )
    // Case transitions to resolved with the posting event.
    expect(transitionCaseForReviewMock).toHaveBeenCalledWith(
      expect.anything(),
      'review-1',
      expect.objectContaining({ status: 'resolved', eventType: 'response_posted' })
    )
  })

  it('approves a draft with rationale and supersedes it on modification', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    mockExistingResponse({
      id: 'response-1',
      review_id: 'review-1',
      status: 'draft',
      response_text: 'Original draft text.',
      shared_action_attempt_id: null,
      reviews: { platform: 'google', property_id: 'property-1' },
    })

    const insertSingle = vi.fn().mockResolvedValue({ data: { id: 'response-2' }, error: null })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insertMock = vi.fn().mockReturnValue({ select: insertSelect })
    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateMock = vi.fn().mockReturnValue({ eq: updateEq })

    serviceFromMock.mockImplementation((table: string) => {
      if (table === 'review_responses') {
        return { insert: insertMock, update: updateMock }
      }
      if (table === 'reviews') {
        return { update: updateMock }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/reviewflow/respond', {
        method: 'PATCH',
        body: JSON.stringify({
          responseId: 'response-1',
          action: 'approve',
          decisionReason: 'Edited for accuracy about amenity hours',
          editedText: 'Modified response text.',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)

    // The modification becomes a new versioned human_written row...
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        response_text: 'Modified response text.',
        response_type: 'human_written',
        status: 'approved',
        decision_reason: 'Edited for accuracy about amenity hours',
      })
    )
    // ...and the original is preserved but superseded.
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ superseded_at: expect.any(String) })
    )
    expect(transitionCaseForReviewMock).toHaveBeenCalledWith(
      expect.anything(),
      'review-1',
      expect.objectContaining({
        status: 'ready_to_post',
        eventType: 'response_modified_and_approved',
      })
    )
  })
})
