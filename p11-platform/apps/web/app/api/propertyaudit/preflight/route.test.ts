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

function makeNextRequest(url: string): NextRequest {
  const request = new Request(url) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('propertyaudit preflight route', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/preflight?propertyId=property-1')
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('reports missing provider configuration before a run starts', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    delete process.env.PERPLEXITY_API_KEY
    process.env.OPENAI_API_KEY = 'openai-key'
    process.env.PROPERTYAUDIT_USE_DATA_ENGINE = 'false'
    process.env.CRON_SECRET = 'cron-secret'

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/preflight?propertyId=property-1&surfaces=perplexity')
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.ready).toBe(false)
    expect(json.surfaces[0]).toMatchObject({
      surface: 'perplexity',
      ready: false,
      missingKeys: ['PERPLEXITY_API_KEY'],
    })
  })

  it('reports data-engine readiness when enabled', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    process.env.PROPERTYAUDIT_USE_DATA_ENGINE = 'true'
    process.env.DATA_ENGINE_URL = 'http://data-engine.local'
    process.env.DATA_ENGINE_API_KEY = 'data-engine-key'
    process.env.OPENAI_API_KEY = 'openai-key'

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/propertyaudit/preflight?propertyId=property-1&surfaces=chatgpt')
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.ready).toBe(true)
    expect(json.runtime.dataEngine).toMatchObject({
      enabled: true,
      ready: true,
      url: 'http://data-engine.local',
    })
  })
})
