import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const listMarketVisionRunsMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/marketvision-jobs', () => ({
  listMarketVisionRuns: listMarketVisionRunsMock,
}))

function makeNextRequest(url: string): NextRequest {
  const request = new Request(url) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('marketvision runs route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/runs?propertyId=property-1'),
    )
    expect(response.status).toBe(401)
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/runs?propertyId=property-1'),
    )
    expect(response.status).toBe(403)
  })

  it('GET derives partial results from completed_partial status reason', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    listMarketVisionRunsMock.mockResolvedValue([
      {
        id: 'run-1',
        runType: 'observation_refresh',
        lifecycleStatus: 'succeeded',
        statusReason: 'completed_partial',
        errorMessage: null,
        queuedAt: null,
        startedAt: null,
        finishedAt: null,
        payload: {},
      },
      {
        id: 'run-2',
        runType: 'discovery',
        lifecycleStatus: 'failed',
        statusReason: 'execution_failed',
        errorMessage: 'provider down',
        queuedAt: null,
        startedAt: null,
        finishedAt: null,
        payload: {},
      },
    ])

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/runs?propertyId=property-1'),
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.runs[0].result).toBe('partial')
    expect(json.runs[1].result).toBe('failed')
  })
})
