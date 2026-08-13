import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const authGetUserMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const loadSiteForgeDirectorSnapshotMock = vi.fn()
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

vi.mock('@/utils/services/request-context', () => ({
  createRequestContext: () => ({
    requestId: 'request-1',
    responseHeaders: { 'X-Request-Id': 'request-1' },
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))

vi.mock('@/utils/siteforge/director/snapshot', async () => {
  const actual = await vi.importActual<
    typeof import('@/utils/siteforge/director/snapshot')
  >('@/utils/siteforge/director/snapshot')
  return {
    ...actual,
    loadSiteForgeDirectorSnapshot: loadSiteForgeDirectorSnapshotMock,
  }
})

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'

function request() {
  return new Request(
    `http://localhost/api/siteforge/director/${WEBSITE_ID}`
  ) as NextRequest
}

describe('GET /api/siteforge/director/[websiteId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { id: WEBSITE_ID, property_id: PROPERTY_ID },
      error: null,
    })
    const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))
    const selectMock = vi.fn(() => ({ eq: eqMock }))
    fromMock.mockReturnValue({ select: selectMock })
    createServiceClientMock.mockReturnValue({ from: fromMock })
    loadSiteForgeDirectorSnapshotMock.mockResolvedValue({
      stage: { key: 'planning' },
      blockers: [],
      identity: {
        websiteId: WEBSITE_ID,
        propertyId: PROPERTY_ID,
      },
    })
  })

  it('returns 401 before loading website state when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(request(), {
      params: Promise.resolve({ websiteId: WEBSITE_ID }),
    })

    expect(response.status).toBe(401)
    expect(fromMock).not.toHaveBeenCalled()
    expect(loadSiteForgeDirectorSnapshotMock).not.toHaveBeenCalled()
  })

  it('fails tenant scope before assembling the snapshot', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { GET } = await import('./route')
    const response = await GET(request(), {
      params: Promise.resolve({ websiteId: WEBSITE_ID }),
    })

    expect(response.status).toBe(403)
    expect(validatePropertyAccessMock).toHaveBeenCalledWith(
      'user-1',
      PROPERTY_ID
    )
    expect(loadSiteForgeDirectorSnapshotMock).not.toHaveBeenCalled()
  })

  it('returns a no-store snapshot for an authorized property user', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })

    const { GET } = await import('./route')
    const response = await GET(request(), {
      params: Promise.resolve({ websiteId: WEBSITE_ID }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(loadSiteForgeDirectorSnapshotMock).toHaveBeenCalledWith(
      WEBSITE_ID,
      expect.objectContaining({ from: fromMock })
    )
    await expect(response.json()).resolves.toMatchObject({
      stage: { key: 'planning' },
    })
  })
})
