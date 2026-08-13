import { describe, expect, it, vi } from 'vitest'
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
  recordConnectorCheckpoint: vi.fn(),
  recordConnectorFailure: vi.fn(),
  recordConnectorReconciliation: vi.fn(),
}))

describe('SiteForge connector operations route', () => {
  it('requires authentication before accepting a durable checkpoint', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const websiteId = '11111111-1111-4111-8111-111111111111'
    const connectorId = '22222222-2222-4222-8222-222222222222'
    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest(
        `http://localhost/api/siteforge/connectors/${websiteId}/${connectorId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'checkpoint',
            propertyId: '33333333-3333-4333-8333-333333333333',
            checkpoint: {
              cursor: 'page:1',
              sourceWatermark: '2026-08-10T10:00:00.000Z',
              capturedAt: '2026-08-10T10:01:00.000Z',
              recordCount: 10,
              snapshotHash: 'a'.repeat(64),
            },
            verificationEvidence: 'Provider worker response request-id-1.',
          }),
        }
      ),
      { params: Promise.resolve({ websiteId, connectorId }) }
    )
    expect(response.status).toBe(401)
  })
})
