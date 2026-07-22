import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const DRAFT_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222'

const authGetUserMock = vi.fn()
const createServerClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const serviceFromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createServerClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: serviceFromMock,
  })),
}))

describe('forgestudio social publish route', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env = { ...originalEnv, CRON_SECRET: 'expected-secret' }
    createServerClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('returns 401 when caller is neither cron-authenticated nor user-authenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/forgestudio/social/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId: DRAFT_ID, connectionIds: [CONNECTION_ID] }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(serviceFromMock).not.toHaveBeenCalled()
  })

  it('returns 403 when user lacks access to the draft property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    serviceFromMock.mockImplementation((table: string) => {
      if (table !== 'content_drafts') throw new Error(`Unexpected table ${table}`)
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: DRAFT_ID, property_id: 'property-1' },
              error: null,
            }),
          })),
        })),
      }
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/forgestudio/social/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId: DRAFT_ID, connectionIds: [CONNECTION_ID] }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(serviceFromMock).toHaveBeenCalledWith('content_drafts')
  })

  it('allows cron-authenticated callers to reach payload validation without user auth', async () => {
    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/forgestudio/social/publish', {
      method: 'POST',
      headers: {
        authorization: 'Bearer expected-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid publish request',
    })
    expect(authGetUserMock).not.toHaveBeenCalled()
  })

  it('rejects non-uuid draft and connection ids', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/forgestudio/social/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId: 'draft-1', connectionIds: ['conn-1'] }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid publish request',
    })
    expect(serviceFromMock).not.toHaveBeenCalled()
  })

  it('returns 409 when the draft is not approved or scheduled', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
    })

    serviceFromMock.mockImplementation((table: string) => {
      if (table !== 'content_drafts') throw new Error(`Unexpected table ${table}`)
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: DRAFT_ID, property_id: 'property-1', status: 'draft' },
              error: null,
            }),
          })),
        })),
      }
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/forgestudio/social/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId: DRAFT_ID, connectionIds: [CONNECTION_ID] }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Only approved or scheduled drafts can be published',
    })
  })

  it('returns 409 when approved draft is partial and not ready to publish', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
    })

    serviceFromMock.mockImplementation((table: string) => {
      if (table !== 'content_drafts') throw new Error(`Unexpected table ${table}`)
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: DRAFT_ID,
                property_id: 'property-1',
                status: 'approved',
                caption: 'Now leasing with limited specials',
                platform: 'instagram',
                content_type: 'social_post',
                media_type: 'image',
                media_urls: [],
              },
              error: null,
            }),
          })),
        })),
      }
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/forgestudio/social/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId: DRAFT_ID, connectionIds: [CONNECTION_ID] }),
    }) as NextRequest

    const response = await POST(request)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Draft is not ready to publish',
      blockers: expect.arrayContaining(['media_required_but_missing']),
    })
  })
})
