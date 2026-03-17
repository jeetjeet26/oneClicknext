import { beforeEach, describe, expect, it, vi } from 'vitest'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createAdminClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('onboarding status route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    createAdminClientMock.mockReturnValue({
      from: fromMock,
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/onboarding/status?propertyId=property-1'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
    })

    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/onboarding/status?propertyId=property-1'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('PATCH returns 403 when task property access is denied', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
    })

    const singleMock = vi.fn().mockResolvedValue({
      data: { id: 'task-1', property_id: 'property-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new Request('http://localhost/api/onboarding/status', {
        method: 'PATCH',
        body: JSON.stringify({ taskId: 'task-1', status: 'completed' }),
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})
