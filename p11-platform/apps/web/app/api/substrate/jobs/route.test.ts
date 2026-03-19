import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const authGetUserMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('GET /api/substrate/jobs', () => {
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
      new Request('http://localhost/api/substrate/jobs?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns jobs for authorized reviewers', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    const profileSingleMock = vi.fn().mockResolvedValue({ data: { role: 'manager' }, error: null })
    const profileEqMock = vi.fn(() => ({ single: profileSingleMock }))
    const profileSelectMock = vi.fn(() => ({ eq: profileEqMock }))
    fromMock.mockReturnValue({ select: profileSelectMock })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({
                data: [{ id: 'job-1', domain: 'forgestudio.publish' }],
                error: null,
              }),
            })),
          })),
        })),
      })),
    })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/substrate/jobs?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      jobs: [{ id: 'job-1', domain: 'forgestudio.publish' }],
    })
  })
})
