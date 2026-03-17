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

describe('siteforge status route auth', () => {
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

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/siteforge/status/website-1'),
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
    serviceFromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/siteforge/status/website-1'),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('GET returns deployment diagnostics when available', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'website-1',
        property_id: 'property-1',
        generation_status: 'deploy_failed',
        generation_progress: 100,
        current_step: 'Deployment failed during verification',
        error_message: 'Deployment verification failed: missing published pages for slugs: home',
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
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    serviceFromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/siteforge/status/website-1'),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        websiteId: 'website-1',
        status: 'deploy_failed',
        brandReadiness: expect.objectContaining({
          degraded: true,
          blockers: expect.arrayContaining(['missing_brand_source', 'missing_brand_confidence']),
        }),
        deploymentReadiness: expect.objectContaining({
          ready: false,
          mode: 'unconfigured',
          blockers: expect.arrayContaining(['missing_wordpress_provider_credentials']),
        }),
        deploymentDiagnostics: expect.objectContaining({
          workflow: 'siteforge_wordpress_deploy',
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
