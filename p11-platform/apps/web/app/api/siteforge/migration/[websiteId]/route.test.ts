import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  createMigrationManifestMock,
  getUserMock,
  validatePropertyAccessMock,
} = vi.hoisted(() => ({
  createMigrationManifestMock: vi.fn(),
  getUserMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))
vi.mock('@/utils/services/runtime-config', () => ({
  getDataEngineUrl: vi.fn(() => 'http://data-engine.local'),
}))
vi.mock('@/utils/siteforge/migration/repository', () => ({
  SiteForgeMigrationError: class SiteForgeMigrationError extends Error {
    statusCode = 500
  },
  createMigrationManifest: createMigrationManifestMock,
  listMigrationManifests: vi.fn(),
}))

describe('SiteForge migration manifest route', () => {
  const websiteId = '11111111-1111-4111-8111-111111111111'
  const propertyId = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires authentication before listing source crawl evidence', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        `http://localhost/api/siteforge/migration/${websiteId}?propertyId=${propertyId}`
      ),
      { params: Promise.resolve({ websiteId }) }
    )
    expect(response.status).toBe(401)
  })

  it('requires authentication before persisting a migration manifest', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest(`http://localhost/api/siteforge/migration/${websiteId}`, {
        method: 'POST',
        body: JSON.stringify({ propertyId }),
      }),
      { params: Promise.resolve({ websiteId }) }
    )
    expect(response.status).toBe(401)
  })

  it('captures a signed manifest from a completed data-engine crawl', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: '33333333-3333-4333-8333-333333333333' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    createMigrationManifestMock.mockResolvedValue({ id: 'manifest-1' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            manifest: {
              propertyId,
              sourceUrl: 'https://source.example.com',
              sourceReadOnly: true,
            },
          }),
          { status: 200 }
        )
      )
    )
    const { POST } = await import('./route')
    const crawlId = '44444444-4444-4444-8444-444444444444'
    const response = await POST(
      new NextRequest(`http://localhost/api/siteforge/migration/${websiteId}`, {
        method: 'POST',
        body: JSON.stringify({
          propertyId,
          crawlId,
          targetUrl: 'https://target.example.com',
        }),
      }),
      { params: Promise.resolve({ websiteId }) }
    )

    expect(response.status).toBe(201)
    expect(fetch).toHaveBeenCalledWith(
      'http://data-engine.local/jobs/siteaudit/manifest',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          crawl_id: crawlId,
          target_url: 'https://target.example.com',
        }),
      })
    )
    expect(createMigrationManifestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: expect.objectContaining({
          propertyId,
          sourceUrl: 'https://source.example.com',
        }),
      })
    )
  })
})
