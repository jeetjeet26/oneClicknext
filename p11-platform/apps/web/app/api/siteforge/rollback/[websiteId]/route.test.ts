import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()
const serviceFromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as NextRequest
}

describe('siteforge rollback route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    serviceFromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/siteforge/rollback/website-1', { method: 'POST' }),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/siteforge/rollback/website-1'),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('POST returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: { id: 'website-1', property_id: 'property-1', version: 3 },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    serviceFromMock.mockReturnValue({ select: selectMock })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/siteforge/rollback/website-1', { method: 'POST' }),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('POST returns 400 when no previous version exists', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const currentSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'website-1',
        property_id: 'property-1',
        version: 3,
        generation_input: { prompt: 'be modern' },
      },
      error: null,
    })
    const previousLimitMock = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })

    const currentEqMock = vi.fn().mockReturnValue({ single: currentSingleMock })
    const previousOrderMock = vi.fn().mockReturnValue({ limit: previousLimitMock })
    const previousLtMock = vi.fn().mockReturnValue({ order: previousOrderMock })
    const previousNeqMock = vi.fn().mockReturnValue({ lt: previousLtMock })
    const previousEqMock = vi.fn().mockReturnValue({ neq: previousNeqMock })
    const selectMock = vi
      .fn()
      .mockReturnValueOnce({ eq: currentEqMock })
      .mockReturnValueOnce({ eq: previousEqMock })

    serviceFromMock.mockReturnValue({ select: selectMock })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/siteforge/rollback/website-1', { method: 'POST' }),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'No previous version is available for rollback',
    })
  })

  it('POST restores website content from previous version', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const currentSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'website-1',
        property_id: 'property-1',
        version: 3,
        generation_input: { prompt: 'be modern' },
      },
      error: null,
    })
    const previousLimitMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'website-0',
          version: 2,
          blueprint: { pages: [{ slug: 'home' }] },
          site_architecture: { navigation: { items: [] } },
          pages_generated: [{ slug: 'home' }],
          assets_manifest: { totalAssets: 2 },
          brand_source: 'brandforge',
          brand_confidence: 0.9,
          user_preferences: { style: 'luxury' },
        },
      ],
      error: null,
    })

    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock })

    const currentEqMock = vi.fn().mockReturnValue({ single: currentSingleMock })
    const previousOrderMock = vi.fn().mockReturnValue({ limit: previousLimitMock })
    const previousLtMock = vi.fn().mockReturnValue({ order: previousOrderMock })
    const previousNeqMock = vi.fn().mockReturnValue({ lt: previousLtMock })
    const previousEqMock = vi.fn().mockReturnValue({ neq: previousNeqMock })

    const tableMock = {
      select: vi
        .fn()
        .mockReturnValueOnce({ eq: currentEqMock })
        .mockReturnValueOnce({ eq: previousEqMock }),
      update: updateMock,
    }
    serviceFromMock.mockReturnValue(tableMock)

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/siteforge/rollback/website-1', { method: 'POST' }),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
        rolledBackFromVersion: 3,
        rolledBackToVersion: 2,
        rolledBackToWebsiteId: 'website-0',
      })
    )

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        previous_version_id: 'website-0',
        generation_status: 'ready_for_preview',
        wp_url: null,
        generation_input: expect.objectContaining({
          prompt: 'be modern',
          rollback: expect.objectContaining({
            fromWebsiteId: 'website-1',
            toWebsiteId: 'website-0',
            fromVersion: 3,
            toVersion: 2,
          }),
        }),
      })
    )
    expect(updateEqMock).toHaveBeenCalledWith('id', 'website-1')
  })

  it('GET returns exact rollback target version for confirmation', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const currentSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'website-1',
        property_id: 'property-1',
        version: 5,
      },
      error: null,
    })
    const previousLimitMock = vi.fn().mockResolvedValue({
      data: [{ id: 'website-4', version: 4 }],
      error: null,
    })

    const currentEqMock = vi.fn().mockReturnValue({ single: currentSingleMock })
    const previousOrderMock = vi.fn().mockReturnValue({ limit: previousLimitMock })
    const previousLtMock = vi.fn().mockReturnValue({ order: previousOrderMock })
    const previousNeqMock = vi.fn().mockReturnValue({ lt: previousLtMock })
    const previousEqMock = vi.fn().mockReturnValue({ neq: previousNeqMock })
    const selectMock = vi
      .fn()
      .mockReturnValueOnce({ eq: currentEqMock })
      .mockReturnValueOnce({ eq: previousEqMock })

    serviceFromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/siteforge/rollback/website-1'),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      canRollback: true,
      currentVersion: 5,
      rollbackToVersion: 4,
      rollbackToWebsiteId: 'website-4',
      message: 'Rollback will restore version 4.',
    })
  })
})
