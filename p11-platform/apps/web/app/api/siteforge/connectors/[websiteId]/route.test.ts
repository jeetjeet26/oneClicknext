import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }))
vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: vi.fn(),
}))
vi.mock('@/utils/siteforge/connectors/repository', () => ({
  SiteForgeConnectorError: class SiteForgeConnectorError extends Error {
    statusCode = 500
  },
  createConnectorConfig: vi.fn(),
  listConnectorConfigs: vi.fn(),
}))

describe('SiteForge connector config route', () => {
  const websiteId = '11111111-1111-4111-8111-111111111111'
  const propertyId = '33333333-3333-3333-3333-333333333333'

  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
  })

  it('requires authentication before listing connector diagnostics', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        `http://localhost/api/siteforge/connectors/${websiteId}?propertyId=${propertyId}`
      ),
      { params: Promise.resolve({ websiteId }) }
    )
    expect(response.status).toBe(401)
  })

  it('requires authentication before storing credential references', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest(`http://localhost/api/siteforge/connectors/${websiteId}`, {
        method: 'POST',
        body: JSON.stringify({ propertyId }),
      }),
      { params: Promise.resolve({ websiteId }) }
    )
    expect(response.status).toBe(401)
  })
})
