import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const REVISION_ID = '11111111-1111-4111-8111-111111111111'

const authGetUserMock = vi.fn()
const createServerClientMock = vi.fn()
const validatePropertyManagerAccessMock = vi.fn()
const setRevisionApprovalMock = vi.fn()
const serviceFromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: serviceFromMock }),
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyManagerAccess: validatePropertyManagerAccessMock,
}))

vi.mock('@/utils/forgestudio/content-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/forgestudio/content-store')>()
  return {
    ...actual,
    setRevisionApproval: setRevisionApprovalMock,
  }
})

function makeRequest(body: unknown): NextRequest {
  return new Request(`http://localhost/api/forgestudio/revisions/${REVISION_ID}/approval`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

const routeParams = { params: Promise.resolve({ revisionId: REVISION_ID }) }

function mockRevisionLookup() {
  serviceFromMock.mockImplementation((table: string) => {
    if (table !== 'social_content_revisions') throw new Error(`Unexpected table ${table}`)
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: REVISION_ID, property_id: 'property-1' },
            error: null,
          }),
        })),
      })),
    }
  })
}

describe('forgestudio revision approval route', () => {
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
    const response = await POST(makeRequest({ decision: 'approved' }), routeParams)
    expect(response.status).toBe(401)
    expect(setRevisionApprovalMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid decision', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    const { POST } = await import('./route')
    const response = await POST(makeRequest({ decision: 'maybe' }), routeParams)
    expect(response.status).toBe(400)
    expect(setRevisionApprovalMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is not a manager or admin', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockRevisionLookup()
    validatePropertyManagerAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Requires admin or manager role',
    })

    const { POST } = await import('./route')
    const response = await POST(makeRequest({ decision: 'approved' }), routeParams)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Requires admin or manager role' })
    expect(setRevisionApprovalMock).not.toHaveBeenCalled()
  })

  it('approves a revision for an authorized manager', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockRevisionLookup()
    validatePropertyManagerAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })
    setRevisionApprovalMock.mockResolvedValue({ id: REVISION_ID, approval_status: 'approved' })

    const { POST } = await import('./route')
    const response = await POST(
      makeRequest({ decision: 'approved', note: 'Looks great' }),
      routeParams
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      revision: { id: REVISION_ID, approval_status: 'approved' },
    })
    expect(setRevisionApprovalMock).toHaveBeenCalledWith({
      revisionId: REVISION_ID,
      decision: 'approved',
      reviewerId: 'user-1',
      note: 'Looks great',
    })
  })

  it('surfaces ContentStoreError conflicts as their status code', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockRevisionLookup()
    validatePropertyManagerAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })

    const { ContentStoreError } = await import('@/utils/forgestudio/content-store')
    setRevisionApprovalMock.mockRejectedValue(
      new ContentStoreError('Only pending revisions can be reviewed', 409)
    )

    const { POST } = await import('./route')
    const response = await POST(makeRequest({ decision: 'approved' }), routeParams)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Only pending revisions can be reviewed',
    })
  })
})
