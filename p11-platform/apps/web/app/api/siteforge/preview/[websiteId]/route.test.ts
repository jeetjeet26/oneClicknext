import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as NextRequest
}

describe('siteforge preview route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/siteforge/preview/website-1'),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: { id: 'website-1', property_id: 'property-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/siteforge/preview/website-1'),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('GET returns deployment diagnostics when available', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const websiteSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'website-1',
        property_id: 'property-1',
        properties: { id: 'property-1', name: 'Sunset Apartments' },
        generation_status: 'deploy_failed',
        brand_source: 'brandforge',
        brand_confidence: 0.9,
        site_architecture: null,
        blueprint: null,
        pages_generated: [],
        wp_url: null,
        wp_admin_url: null,
        created_at: '2026-03-13T16:00:00.000Z',
        generation_completed_at: null,
        generation_input: {
          deploymentDiagnostics: {
            workflow: 'siteforge_wordpress_deploy',
            status: 'failed',
            provider: 'existing_wordpress',
            startedAt: '2026-03-13T16:00:00.000Z',
            completedAt: '2026-03-13T16:05:00.000Z',
            pagesAttempted: 1,
            assetsAttempted: 1,
            verification: {
              enabled: true,
              status: 'failed',
            },
            error: {
              message: 'Deployment verification failed: missing published pages for slugs: home',
              category: 'verification',
            },
          },
        },
      },
      error: null,
    })
    const websiteEqMock = vi.fn().mockReturnValue({ single: websiteSingleMock })
    const websiteSelectMock = vi.fn().mockReturnValue({ eq: websiteEqMock })

    const assetsEqMock = vi.fn().mockResolvedValue({ data: [], error: null })
    const assetsSelectMock = vi.fn().mockReturnValue({ eq: assetsEqMock })

    fromMock.mockImplementation((table: string) => {
      if (table === 'property_websites') {
        return { select: websiteSelectMock }
      }
      if (table === 'website_assets') {
        return { select: assetsSelectMock }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/siteforge/preview/website-1'),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        websiteId: 'website-1',
        brandReadiness: expect.objectContaining({
          degraded: false,
          source: 'brandforge',
          confidence: 0.9,
          blockers: [],
        }),
        deploymentReadiness: expect.objectContaining({
          ready: false,
          mode: 'unconfigured',
          blockers: expect.arrayContaining(['missing_wordpress_provider_credentials']),
        }),
        deploymentDiagnostics: expect.objectContaining({
          status: 'failed',
          provider: 'existing_wordpress',
          error: expect.objectContaining({
            category: 'verification',
          }),
        }),
      })
    )
  })
})
