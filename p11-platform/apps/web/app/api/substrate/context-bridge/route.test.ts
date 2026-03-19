import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createClientMock = vi.fn()
const authGetUserMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const createServiceClientMock = vi.fn()
const buildBusinessContextBridgeMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/substrate/business-context-bridge', () => ({
  buildBusinessContextBridge: buildBusinessContextBridgeMock,
}))

describe('GET /api/substrate/context-bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    createServiceClientMock.mockReturnValue({ from: vi.fn() })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/substrate/context-bridge?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/substrate/context-bridge?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns assembled read-only context bridge payload', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    buildBusinessContextBridgeMock.mockResolvedValue({
      propertyId: 'property-1',
      asOf: '2026-03-17T00:00:00.000Z',
      readOnly: true,
      setup: { onboardingCompleted: true, missingCoreFields: [], profile: { name: 'Sunset', propertyType: 'apartment', websiteUrl: 'https://x.com', unitCount: 100, targetAudience: null, brandVoice: null } },
      knowledge: { sourceCount: 1, completedSources: 1, failedSources: 0, documentCount: 5, latestSyncedAt: null },
      brand: { brandBookCount: 1, latestGeneratedAt: null },
      bi: { lastImportState: 'complete', hasImportWarnings: false, lastImportAt: null, marketing30d: { spend: 0, clicks: 0, conversions: 0, impressions: 0 } },
      integrations: { configuredCount: 0, verifiedCount: 0, errorCount: 0, crmReady: false, emailReady: false, calendarReady: false, adPlatformsReady: {} },
      substrate: { sharedJobCount: 0, latestJobAt: null, lifecycleCounts: { queued: 0, running: 0, succeeded: 0, failed: 0, retrying: 0, cancelled: 0 } },
      citations: [],
    })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/substrate/context-bridge?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      context: {
        propertyId: 'property-1',
        readOnly: true,
      },
    })
    expect(buildBusinessContextBridgeMock).toHaveBeenCalledTimes(1)
  })
})

