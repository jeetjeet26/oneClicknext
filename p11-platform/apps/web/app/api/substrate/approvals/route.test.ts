import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createClientMock = vi.fn()
const authGetUserMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const listPendingSharedApprovalCandidatesMock = vi.fn()
const recordSharedApprovalDecisionMock = vi.fn()
const resumeSharedActionAttemptMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/shared-approvals', async () => {
  const actual = await vi.importActual<typeof import('@/utils/services/shared-approvals')>(
    '@/utils/services/shared-approvals'
  )
  return {
    ...actual,
    listPendingSharedApprovalCandidates: listPendingSharedApprovalCandidatesMock,
    recordSharedApprovalDecision: recordSharedApprovalDecisionMock,
  }
})

vi.mock('@/utils/services/shared-dispatcher', async () => {
  const actual = await vi.importActual<typeof import('@/utils/services/shared-dispatcher')>(
    '@/utils/services/shared-dispatcher'
  )
  return {
    ...actual,
    resumeSharedActionAttempt: resumeSharedActionAttemptMock,
  }
})

describe('GET/POST /api/substrate/approvals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/substrate/approvals?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when reviewer role is insufficient', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    const singleMock = vi.fn().mockResolvedValue({ data: { role: 'member' }, error: null })
    const eqMock = vi.fn(() => ({ single: singleMock }))
    const selectMock = vi.fn(() => ({ eq: eqMock }))
    fromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/substrate/approvals?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Permission denied' })
  })

  it('lists pending approval candidates for authorized reviewers', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    const singleMock = vi.fn().mockResolvedValue({ data: { role: 'manager' }, error: null })
    const eqMock = vi.fn(() => ({ single: singleMock }))
    const selectMock = vi.fn(() => ({ eq: eqMock }))
    fromMock.mockReturnValue({ select: selectMock })
    listPendingSharedApprovalCandidatesMock.mockResolvedValue([{ id: 'action-1' }])

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/substrate/approvals?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ approvals: [{ id: 'action-1' }] })
  })

  it('returns 400 when modify decision omits modified payload', async () => {
    const { SharedApprovalError } = await import('@/utils/services/shared-approvals')
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    const singleMock = vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null })
    const eqMock = vi.fn(() => ({ single: singleMock }))
    const selectMock = vi.fn(() => ({ eq: eqMock }))
    fromMock.mockReturnValue({ select: selectMock })
    recordSharedApprovalDecisionMock.mockRejectedValue(
      new SharedApprovalError('modifiedPayload is required when decisionStatus is modified', 400)
    )

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/substrate/approvals', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: 'property-1',
          actionAttemptId: 'action-1',
          decisionStatus: 'modified',
          decisionReason: 'adjust this',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'modifiedPayload is required when decisionStatus is modified',
    })
  })

  it('records approval decisions for authorized reviewers', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    const singleMock = vi.fn().mockResolvedValue({ data: { role: 'manager' }, error: null })
    const eqMock = vi.fn(() => ({ single: singleMock }))
    const selectMock = vi.fn(() => ({ eq: eqMock }))
    fromMock.mockReturnValue({ select: selectMock })
    recordSharedApprovalDecisionMock.mockResolvedValue({
      approval: { id: 'approval-1' },
      policyDecision: null,
      actionAttempt: { id: 'action-1', proposalDecisionStatus: 'approved' },
    })
    resumeSharedActionAttemptMock.mockResolvedValue({ success: true })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/substrate/approvals', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: 'property-1',
          actionAttemptId: 'action-1',
          decisionStatus: 'approved',
          decisionReason: 'approved for execution',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      approval: { id: 'approval-1' },
      executionResult: { success: true },
    })
  })
})

