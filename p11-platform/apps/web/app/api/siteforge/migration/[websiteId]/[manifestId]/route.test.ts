import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }))
vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: vi.fn(),
}))
vi.mock('@/utils/siteforge/migration/repository', () => ({
  SiteForgeMigrationError: class SiteForgeMigrationError extends Error {
    statusCode = 500
  },
  decideMigrationManifest: vi.fn(),
  recordMigrationImported: vi.fn(),
  recordPostLaunchCrawlVerification: vi.fn(),
}))

describe('SiteForge migration command route', () => {
  it('requires authentication before shared-substrate approval', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const websiteId = '11111111-1111-4111-8111-111111111111'
    const manifestId = '22222222-2222-4222-8222-222222222222'
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest(
        `http://localhost/api/siteforge/migration/${websiteId}/${manifestId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'decide',
            propertyId: '33333333-3333-4333-8333-333333333333',
            contentHash: 'a'.repeat(64),
            decisionStatus: 'approved',
            decisionReason: 'Parity evidence reviewed.',
          }),
        }
      ),
      { params: Promise.resolve({ websiteId, manifestId }) }
    )
    expect(response.status).toBe(401)
  })
})
