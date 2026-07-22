import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

const authGetUserMock = vi.fn()
const createServerClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const createBriefMock = vi.fn()
const serviceFromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: serviceFromMock }),
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/forgestudio/content-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/forgestudio/content-store')>()
  return {
    ...actual,
    createBrief: createBriefMock,
  }
})

function makePostRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/forgestudio/briefs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

const validBody = {
  propertyId: PROPERTY_ID,
  title: 'Pool season kickoff',
  objective: 'Drive tour bookings for summer',
  channels: ['facebook', 'instagram'],
}

describe('forgestudio briefs route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    createServerClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    const response = await POST(makePostRequest(validBody))
    expect(response.status).toBe(401)
    expect(createBriefMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid brief payload', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    const { POST } = await import('./route')
    const response = await POST(
      makePostRequest({ ...validBody, channels: ['myspace'] })
    )
    expect(response.status).toBe(400)
    expect(validatePropertyAccessMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the user cannot access the property', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    const { POST } = await import('./route')
    const response = await POST(makePostRequest(validBody))
    expect(response.status).toBe(403)
    expect(createBriefMock).not.toHaveBeenCalled()
  })

  it('creates a brief for an authorized user', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })
    createBriefMock.mockResolvedValue({ id: 'brief-1', title: 'Pool season kickoff' })

    const { POST } = await import('./route')
    const response = await POST(makePostRequest(validBody))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      brief: { id: 'brief-1', title: 'Pool season kickoff' },
    })
    expect(createBriefMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        propertyId: PROPERTY_ID,
        createdBy: 'user-1',
        channels: ['facebook', 'instagram'],
      })
    )
  })

  it('lists briefs scoped to an accessible property', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })

    const limitMock = vi.fn().mockResolvedValue({ data: [{ id: 'brief-1' }], error: null })
    serviceFromMock.mockImplementation((table: string) => {
      if (table !== 'social_content_briefs') throw new Error(`Unexpected table ${table}`)
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({ limit: limitMock })),
          })),
        })),
      }
    })

    const { GET } = await import('./route')
    const request = new Request(
      `http://localhost/api/forgestudio/briefs?propertyId=${PROPERTY_ID}`
    ) as NextRequest
    const response = await GET(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ briefs: [{ id: 'brief-1' }] })
  })
})
