import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const embeddingsCreateMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    embeddings = {
      create: embeddingsCreateMock,
    }
    chat = {
      completions: {
        create: vi.fn(),
      },
    }
  },
}))

describe('onboarding scrape-website route', () => {
  const originalEnv = { ...process.env }
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.INTERNAL_API_KEY
    delete process.env.OPENAI_API_KEY

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when caller is neither internal nor authenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/onboarding/scrape-website', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls: ['https://example.com'] }),
    }) as NextRequest

    const response = await POST(request)
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 for internal calls without propertyId', async () => {
    process.env.INTERNAL_API_KEY = 'internal-secret'

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/onboarding/scrape-website', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer internal-secret',
      },
      body: JSON.stringify({ websiteUrl: 'https://example.com' }),
    }) as NextRequest

    const response = await POST(request)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'propertyId is required for internal calls',
    })
  })

  it('returns 403 when authenticated user lacks property access', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
      error: 'Forbidden',
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/onboarding/scrape-website', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'property-1',
        urls: ['https://example.com'],
      }),
    }) as NextRequest

    const response = await POST(request)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('accepts legacy websiteUrl payload for authenticated users', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        '<html><head><title>Example Apartments</title></head><body>' +
          'Luxury apartments with pool and fitness center. '.repeat(10) +
          '</body></html>',
        { status: 200 }
      )
    ) as typeof global.fetch

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/onboarding/scrape-website', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ websiteUrl: 'https://example.com' }),
    }) as NextRequest

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.pagesScraped).toBe(1)
  })

  it('writes extracted setup fields to properties for propertyId calls', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    embeddingsCreateMock.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    })

    const documentInsertMock = vi.fn().mockResolvedValue({ error: null })
    const documentsDeleteSourceEqMock = vi.fn().mockResolvedValue({ error: null })
    const documentsDeleteTypeEqMock = vi.fn().mockReturnValue({ eq: documentsDeleteSourceEqMock })
    const documentsDeletePropertyEqMock = vi.fn().mockReturnValue({ eq: documentsDeleteTypeEqMock })
    const documentsDeleteMock = vi.fn().mockReturnValue({ eq: documentsDeletePropertyEqMock })
    const sourceMaybeSingleMock = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const sourceSelectMatchUrlEqMock = vi.fn().mockReturnValue({ maybeSingle: sourceMaybeSingleMock })
    const sourceSelectAfterSourceName = { eq: sourceSelectMatchUrlEqMock }
    const sourceSelectMatchSourceTypeEqMock = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockReturnValue(sourceSelectAfterSourceName) })
    const sourceSelectMock = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: sourceSelectMatchSourceTypeEqMock }) })
    const sourceInsertSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'source-1' },
      error: null,
    })
    const sourceInsertSelectMock = vi.fn().mockReturnValue({ single: sourceInsertSingleMock })
    const sourceInsertMock = vi.fn().mockReturnValue({ select: sourceInsertSelectMock })
    const propertyUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const propertyUpdateMock = vi.fn().mockReturnValue({ eq: propertyUpdateEqMock })

    const adminFromMock = vi.fn((table: string) => {
      if (table === 'documents') {
        return {
          delete: documentsDeleteMock,
          insert: documentInsertMock,
        }
      }
      if (table === 'knowledge_sources') {
        return {
          select: sourceSelectMock,
          insert: sourceInsertMock,
        }
      }
      if (table === 'properties') {
        return { update: propertyUpdateMock }
      }
      throw new Error(`Unexpected table ${table}`)
    })
    createServiceClientMock.mockReturnValue({ from: adminFromMock })

    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        '<html><head><title>Example Apartments</title></head><body>' +
          'Luxury apartments with pool and fitness center. '.repeat(10) +
          '</body></html>',
        { status: 200 }
      )
    ) as typeof global.fetch

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/onboarding/scrape-website', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'property-1',
        urls: ['https://example.com'],
      }),
    }) as NextRequest

    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(documentsDeleteMock).toHaveBeenCalled()
    expect(documentsDeletePropertyEqMock).toHaveBeenCalledWith('property_id', 'property-1')
    expect(documentsDeleteTypeEqMock).toHaveBeenCalledWith('metadata->>source_type', 'website_scrape')
    expect(documentsDeleteSourceEqMock).toHaveBeenCalledWith('metadata->>source_origin', 'https://example.com')
    expect(sourceInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'website',
        extracted_data: expect.objectContaining({
          brand_origin: 'client_provided_material',
        }),
      })
    )
    expect(adminFromMock).toHaveBeenCalledWith('properties')
    expect(propertyUpdateMock).toHaveBeenCalled()
    expect(propertyUpdateEqMock).toHaveBeenCalledWith('id', 'property-1')
  })

  afterEach(() => {
    global.fetch = originalFetch
  })
})
