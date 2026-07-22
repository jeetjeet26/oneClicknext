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

// Pass-through durable-job wrapper: executes the work and reports the same
// outcome/partial semantics as the real implementation, without touching the
// shared_jobs ledger (covered by marketvision-jobs unit tests).
const runIngestionJobSpy = vi.fn()
vi.mock('@/utils/services/marketvision-jobs', () => {
  class MarketVisionActiveRunError extends Error {
    sharedJobId: string
    lifecycleStatus: string
    constructor(message: string, sharedJobId: string, lifecycleStatus: string) {
      super(message)
      this.name = 'MarketVisionActiveRunError'
      this.sharedJobId = sharedJobId
      this.lifecycleStatus = lifecycleStatus
    }
  }
  class MarketVisionRunFailedError extends Error {
    outcome: { total: number; succeeded: number; failed: number; data: unknown }
    constructor(
      message: string,
      outcome: { total: number; succeeded: number; failed: number; data: unknown },
    ) {
      super(message)
      this.name = 'MarketVisionRunFailedError'
      this.outcome = outcome
    }
  }
  return {
    MarketVisionActiveRunError,
    MarketVisionRunFailedError,
    runMarketVisionIngestionJob: async (input: {
      execute: () => Promise<{ total: number; succeeded: number; failed: number; data: unknown }>
    }) => {
      runIngestionJobSpy(input)
      const outcome = await input.execute()
      if (outcome.total > 0 && outcome.succeeded === 0 && outcome.failed > 0) {
        throw new MarketVisionRunFailedError('All sources failed', outcome)
      }
      return {
        sharedJobId: 'shared-job-1',
        outcome,
        result: outcome.failed > 0 && outcome.succeeded > 0 ? 'partial' : 'succeeded',
      }
    },
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

interface SupabaseMockOptions {
  competitorFound?: boolean
}

function mockSupabase({ competitorFound = true }: SupabaseMockOptions = {}) {
  const upsertMock = vi.fn().mockResolvedValue({ error: null })
  const fromMock = vi.fn((table: string) => {
    if (table === 'properties') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'property-1',
                name: 'Subject Property',
                org_id: 'org-1',
                address: { city: 'Austin', state: 'TX' },
              },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'competitors') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: competitorFound
                  ? { id: 'competitor-1', property_id: 'property-1' }
                  : null,
                error: null,
              }),
            }),
          }),
        }),
      }
    }
    if (table === 'scrape_config') {
      return { upsert: upsertMock, select: vi.fn() }
    }
    throw new Error(`Unexpected table ${table}`)
  })

  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: fromMock,
  })

  return { fromMock, upsertMock }
}

describe('marketvision scrape route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/scrape', {
        method: 'POST',
        body: JSON.stringify({ action: 'refresh', propertyId: 'property-1' }),
      }),
    )
    expect(response.status).toBe(401)
  })

  it('POST returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/scrape', {
        method: 'POST',
        body: JSON.stringify({ action: 'refresh', propertyId: 'property-1' }),
      }),
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})

describe('marketvision scrape route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
  })

  it('POST refresh calls the /scraper/refresh-pricing endpoint with the API key', async () => {
    mockSupabase()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        total_competitors: 3,
        updated_count: 2,
        website_updated: 2,
        ils_updated: 0,
        error_count: 1,
        errors: [],
      }),
    }) as typeof fetch

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/scrape', {
        method: 'POST',
        body: JSON.stringify({ action: 'refresh', propertyId: 'property-1' }),
      }),
    )

    expect(response.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://data-engine.test/scraper/refresh-pricing',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Key': 'engine-key' }),
      }),
    )
    const json = await response.json()
    // The refresh summary must be nested under `result` for the UI contract
    expect(json.result.updated_count).toBe(2)
    expect(json.result.error_count).toBe(1)
    // Batch refresh runs under the durable shared-job ledger with a
    // visible partial outcome (2 succeeded, 1 failed).
    expect(runIngestionJobSpy).toHaveBeenCalled()
    expect(json.sharedJobId).toBe('shared-job-1')
    expect(json.runResult).toBe('partial')
  })

  it('POST refresh returns 502 (not success) when every source fails', async () => {
    mockSupabase()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        total_competitors: 2,
        updated_count: 0,
        error_count: 2,
        errors: [],
      }),
    }) as typeof fetch

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/scrape', {
        method: 'POST',
        body: JSON.stringify({ action: 'refresh', propertyId: 'property-1' }),
      }),
    )

    expect(response.status).toBe(502)
    const json = await response.json()
    expect(json.counts).toEqual({ total: 2, succeeded: 0, failed: 2 })
  })

  it('POST rejects a competitor that belongs to a different property', async () => {
    mockSupabase({ competitorFound: false })
    global.fetch = vi.fn() as unknown as typeof fetch

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/scrape', {
        method: 'POST',
        body: JSON.stringify({
          action: 'refresh-website-single',
          propertyId: 'property-1',
          competitorId: 'competitor-from-other-tenant',
        }),
      }),
    )

    expect(response.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POST rejects unsafe website URLs before dispatching (SSRF)', async () => {
    mockSupabase()
    global.fetch = vi.fn() as unknown as typeof fetch

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/scrape', {
        method: 'POST',
        body: JSON.stringify({
          action: 'refresh-website-single',
          propertyId: 'property-1',
          competitorId: 'competitor-1',
          url: 'http://169.254.169.254/latest/meta-data',
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POST rejects non-apartments.com URLs for apartments refresh', async () => {
    mockSupabase()
    global.fetch = vi.fn() as unknown as typeof fetch

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/scrape', {
        method: 'POST',
        body: JSON.stringify({
          action: 'refresh-apartments-single',
          propertyId: 'property-1',
          competitorId: 'competitor-1',
          url: 'https://evil.com/apartments.com/listing',
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POST forwards property_id for competitor-scoped refresh calls', async () => {
    mockSupabase()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, units_updated: 1 }),
    }) as typeof fetch

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/scrape', {
        method: 'POST',
        body: JSON.stringify({
          action: 'refresh-website-single',
          propertyId: 'property-1',
          competitorId: 'competitor-1',
        }),
      }),
    )

    expect(response.status).toBe(200)
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(JSON.parse(init.body)).toMatchObject({
      property_id: 'property-1',
      competitor_id: 'competitor-1',
    })
  })
})
