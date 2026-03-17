import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const deployToWordPressMock = vi.fn()
const deployToExistingWordPressMock = vi.fn()
const getPropertyContextMock = vi.fn()
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

vi.mock('@/utils/siteforge/wordpress-client', () => ({
  deployToWordPress: deployToWordPressMock,
  deployToExistingWordPress: deployToExistingWordPressMock,
}))

vi.mock('@/utils/siteforge/brand-intelligence', () => ({
  getPropertyContext: getPropertyContextMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as NextRequest
}

describe('siteforge deploy route auth', () => {
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
      makeNextRequest('http://localhost/api/siteforge/deploy/website-1', { method: 'POST' }),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('POST returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: { id: 'website-1', property_id: 'property-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    serviceFromMock.mockReturnValue({ select: selectMock })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/siteforge/deploy/website-1', { method: 'POST' }),
      { params: Promise.resolve({ websiteId: 'website-1' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})

describe('siteforge deploy background diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('persists success deployment diagnostics after cloudways deployment', async () => {
    vi.stubEnv('CLOUDWAYS_API_KEY', 'cw-key')
    vi.stubEnv('CLOUDWAYS_EMAIL', 'jesse@p11.com')
    vi.stubEnv('SITEFORGE_WP_URL', '')
    vi.stubEnv('SITEFORGE_WP_USERNAME', '')
    vi.stubEnv('SITEFORGE_WP_APP_PASSWORD', '')

    const page = {
      slug: 'home',
      title: 'Home',
      purpose: 'Convert visitors',
      sections: [],
    }

    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock })
    const serviceFromMock = vi.fn((table: string) => {
      if (table === 'website_assets') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'logo-asset', website_id: 'website-1' }],
              error: null,
            }),
          }),
        }
      }
      if (table === 'property_websites') {
        return {
          update: updateMock,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })
    getPropertyContextMock.mockResolvedValue({
      name: 'Sunset Apartments',
      tagline: 'Tour today',
    })
    deployToWordPressMock.mockResolvedValue({
      instanceId: '50710',
      url: 'https://sunset-50710.cloudwaysapps.com',
      adminUrl: 'https://sunset-50710.cloudwaysapps.com/wp-admin',
      credentials: { username: 'admin', password: 'wp-secret' },
    })

    const { deployToWordPressAsync } = await import('./route')
    await deployToWordPressAsync('website-1', {
      property_id: 'property-1',
      blueprint: { pages: [page], version: 7, updatedAt: '2026-03-16T00:00:00.000Z' },
      site_blueprint_version: 7,
      generation_input: { prompt: 'Use a luxury tone' },
    })

    expect(updateMock).toHaveBeenCalled()
    expect(updateMock.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        generation_status: 'complete',
        error_message: null,
        current_step: 'Deployment complete (verified 1 pages, 1 assets).',
        generation_input: expect.objectContaining({
          prompt: 'Use a luxury tone',
          deploymentDiagnostics: expect.objectContaining({
            status: 'success',
            provider: 'cloudways',
            pagesAttempted: 1,
            assetsAttempted: 1,
            verification: expect.objectContaining({
              enabled: true,
              status: 'passed',
            }),
            target: expect.objectContaining({
              url: 'https://sunset-50710.cloudwaysapps.com',
            }),
            deploySource: {
              field: 'blueprint',
              blueprintVersion: 7,
              blueprintUpdatedAt: '2026-03-16T00:00:00.000Z',
            },
          }),
        }),
      })
    )
    expect(updateEqMock).toHaveBeenCalledWith('id', 'website-1')
  })

  it('persists verification failure diagnostics when deployment verification fails', async () => {
    vi.stubEnv('CLOUDWAYS_API_KEY', '')
    vi.stubEnv('CLOUDWAYS_EMAIL', '')
    vi.stubEnv('SITEFORGE_WP_URL', 'https://site.example.com')
    vi.stubEnv('SITEFORGE_WP_USERNAME', 'admin')
    vi.stubEnv('SITEFORGE_WP_APP_PASSWORD', 'app-password')

    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock })
    const serviceFromMock = vi.fn((table: string) => {
      if (table === 'website_assets') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'logo-asset', website_id: 'website-1' }],
              error: null,
            }),
          }),
        }
      }
      if (table === 'property_websites') {
        return {
          update: updateMock,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })
    getPropertyContextMock.mockResolvedValue({
      name: 'Sunset Apartments',
      tagline: 'Tour today',
    })
    deployToExistingWordPressMock.mockRejectedValue(
      new Error('Deployment verification failed: missing published pages for slugs: home')
    )

    const { deployToWordPressAsync } = await import('./route')
    await deployToWordPressAsync('website-1', {
      property_id: 'property-1',
      pages_generated: [{ slug: 'home', title: 'Home', purpose: 'Convert', sections: [] }],
      generation_input: { prompt: 'Use a luxury tone' },
    })

    expect(updateMock).toHaveBeenCalled()
    expect(updateMock.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        generation_status: 'deploy_failed',
        current_step: 'Deployment failed during verification',
        error_message: 'Deployment verification failed: missing published pages for slugs: home',
        generation_input: expect.objectContaining({
          prompt: 'Use a luxury tone',
          deploymentDiagnostics: expect.objectContaining({
            status: 'failed',
            provider: 'existing_wordpress',
            pagesAttempted: 1,
            assetsAttempted: 1,
            verification: expect.objectContaining({
              status: 'failed',
            }),
            error: expect.objectContaining({
              category: 'verification',
            }),
            deploySource: {
              field: 'pages_generated',
              blueprintVersion: null,
              blueprintUpdatedAt: null,
            },
          }),
        }),
      })
    )
    expect(updateEqMock).toHaveBeenCalledWith('id', 'website-1')
  })

  it('persists deterministic local simulation diagnostics when enabled', async () => {
    vi.stubEnv('CLOUDWAYS_API_KEY', '')
    vi.stubEnv('CLOUDWAYS_EMAIL', '')
    vi.stubEnv('SITEFORGE_WP_URL', '')
    vi.stubEnv('SITEFORGE_WP_USERNAME', '')
    vi.stubEnv('SITEFORGE_WP_APP_PASSWORD', '')
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'http://127.0.0.1:3000')

    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock })
    const localServiceFromMock = vi.fn((table: string) => {
      if (table === 'website_assets') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }
      }
      if (table === 'property_websites') {
        return {
          update: updateMock,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    createServiceClientMock.mockReturnValue({
      from: localServiceFromMock,
    })

    const { deployToWordPressAsync } = await import('./route')
    await deployToWordPressAsync(
      'website-1',
      {
        property_id: 'property-1',
        pages_generated: [{ slug: 'home', title: 'Home', purpose: 'Convert', sections: [] }],
        generation_input: { prompt: 'Use a luxury tone' },
      },
      { localSimulation: true }
    )

    expect(getPropertyContextMock).not.toHaveBeenCalled()
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generation_status: 'complete',
        wp_url: 'http://127.0.0.1:3000/siteforge/preview/website-1',
        wp_admin_url: 'http://127.0.0.1:3000/siteforge/preview/website-1',
        generation_input: expect.objectContaining({
          deploymentDiagnostics: expect.objectContaining({
            status: 'success',
            provider: 'local_simulation',
            deploySource: {
              field: 'pages_generated',
              blueprintVersion: null,
              blueprintUpdatedAt: null,
            },
            verification: expect.objectContaining({
              status: 'passed',
              message: 'Deployment verified in deterministic local simulation mode.',
            }),
          }),
        }),
      })
    )
    expect(updateEqMock).toHaveBeenCalledWith('id', 'website-1')
  })
})
