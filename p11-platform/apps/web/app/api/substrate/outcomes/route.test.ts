import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createClientMock = vi.fn()
const authGetUserMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const recordSharedOutcomeMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/shared-outcomes', async () => {
  const actual = await vi.importActual<typeof import('@/utils/services/shared-outcomes')>(
    '@/utils/services/shared-outcomes'
  )
  return {
    ...actual,
    recordSharedOutcome: recordSharedOutcomeMock,
  }
})

describe('POST /api/substrate/outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/substrate/outcomes', { method: 'POST' }) as NextRequest)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('records outcomes for authorized reviewers', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    const profileSingleMock = vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null })
    const profileEqMock = vi.fn(() => ({ single: profileSingleMock }))
    const profileSelectMock = vi.fn(() => ({ eq: profileEqMock }))
    fromMock.mockReturnValue({ select: profileSelectMock })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    recordSharedOutcomeMock.mockResolvedValue({ id: 'outcome-1' })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/substrate/outcomes', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: 'property-1',
          actionAttemptId: 'action-1',
          kpiName: 'tours_booked',
          observedValue: 1,
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      outcome: { id: 'outcome-1' },
    })
  })
})
