import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/runtime-config', () => ({
  getDataEngineUrl: () => 'http://data-engine.test',
  getDataEngineHeaders: () => ({
    'Content-Type': 'application/json',
    'X-API-Key': 'engine-key',
  }),
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('marketvision brand-intelligence route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('GET returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/marketvision/brand-intelligence?propertyId=property-1'))
    expect(response.status).toBe(401)
  })

  it('GET returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/marketvision/brand-intelligence?propertyId=property-1'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})

describe('marketvision brand-intelligence route contracts', () => {
  function mockPropertyClient() {
    const singleMock = vi.fn().mockResolvedValue({
      data: { id: 'property-1', name: 'Subject', org_id: 'org-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn(() => ({ select: selectMock })),
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
  })

  it('POST returns 202 with the job id when extraction starts', async () => {
    mockPropertyClient()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: { job_id: 'job-9', competitor_count: 3 },
      }),
    }) as typeof fetch

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/brand-intelligence', {
        method: 'POST',
        body: JSON.stringify({ propertyId: 'property-1' }),
      }),
    )

    expect(response.status).toBe(202)
    const json = await response.json()
    expect(json.jobId).toBe('job-9')
    expect(json.status).toBe('processing')
  })

  it('POST reports skipped (not processing) when the data engine returns a null job id', async () => {
    mockPropertyClient()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        message: 'No competitors to process',
        data: { job_id: null },
      }),
    }) as typeof fetch

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/brand-intelligence', {
        method: 'POST',
        body: JSON.stringify({ propertyId: 'property-1' }),
      }),
    )

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.jobId).toBe(null)
    expect(json.status).toBe('skipped')
  })
})
