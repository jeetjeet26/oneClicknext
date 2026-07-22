import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const getLatestMarketBriefMock = vi.fn()
const generateMarketBriefMock = vi.fn()
const persistMarketBriefMock = vi.fn()
const runIngestionJobMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/marketvision/brief', () => ({
  getLatestMarketBrief: getLatestMarketBriefMock,
  generateMarketBrief: generateMarketBriefMock,
  persistMarketBrief: persistMarketBriefMock,
}))

vi.mock('@/utils/services/marketvision-jobs', () => {
  class MarketVisionActiveRunError extends Error {
    sharedJobId = 'active-job'
    lifecycleStatus = 'running'
  }
  return {
    MarketVisionActiveRunError,
    runMarketVisionIngestionJob: runIngestionJobMock,
  }
})

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('marketvision brief route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'property-1', org_id: 'org-1' },
              error: null,
            }),
          }),
        }),
      })),
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/brief?propertyId=property-1'),
    )
    expect(response.status).toBe(401)
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/brief?propertyId=property-1'),
    )
    expect(response.status).toBe(403)
  })

  it('GET returns null brief when none has been generated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    getLatestMarketBriefMock.mockResolvedValue(null)

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/brief?propertyId=property-1'),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ brief: null, briefId: null })
  })

  it('POST generates and persists a brief through the durable job ledger', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    runIngestionJobMock.mockImplementation(async (input) => {
      const outcome = await input.execute()
      return { sharedJobId: 'shared-job-1', outcome, result: 'succeeded' }
    })
    generateMarketBriefMock.mockResolvedValue({ propertyId: 'property-1' })
    persistMarketBriefMock.mockResolvedValue('brief-1')

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/brief', {
        method: 'POST',
        body: JSON.stringify({ propertyId: 'property-1' }),
      }),
    )

    expect(response.status).toBe(201)
    const json = await response.json()
    expect(json.briefId).toBe('brief-1')
    expect(json.sharedJobId).toBe('shared-job-1')
    expect(runIngestionJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ runType: 'brief_generation', orgId: 'org-1' }),
    )
  })

  it('POST returns 409 when a brief generation run is already active', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    const { MarketVisionActiveRunError } = await import('@/utils/services/marketvision-jobs')
    runIngestionJobMock.mockRejectedValue(new MarketVisionActiveRunError('busy', 'j', 'running'))

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/brief', {
        method: 'POST',
        body: JSON.stringify({ propertyId: 'property-1' }),
      }),
    )

    expect(response.status).toBe(409)
  })
})
