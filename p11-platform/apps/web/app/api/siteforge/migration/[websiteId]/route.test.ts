import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getUserMock, validatePropertyAccessMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))
vi.mock('@/utils/siteforge/migration/repository', () => ({
  SiteForgeMigrationError: class SiteForgeMigrationError extends Error {
    statusCode = 500
  },
  createMigrationManifest: vi.fn(),
  listMigrationManifests: vi.fn(),
}))

describe('SiteForge migration manifest route', () => {
  const websiteId = '11111111-1111-4111-8111-111111111111'
  const propertyId = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
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
})
