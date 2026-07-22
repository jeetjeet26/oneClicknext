import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeJsonRequest,
  makeNextRequest,
  mockAuthenticatedUser,
  mockForbiddenPropertyAccess,
  mockGrantedPropertyAccess,
  mockUnauthenticatedUser,
} from '@/test/route-test-helpers'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
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

describe('competitor intake route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true }),
      text: vi.fn().mockResolvedValue(''),
    }) as typeof fetch
  })

  it('POST returns 401 when unauthenticated', async () => {
    mockUnauthenticatedUser(authGetUserMock)

    const { POST } = await import('./route')
    const response = await POST(makeJsonRequest('http://localhost/api/competitors/intake', {
      body: { propertyId: 'property-1', rawText: 'Brookhaven by Century Communities (El Monte, CA). Notes.' },
    }))

    expect(response.status).toBe(401)
  })

  it('POST returns 403 when property access is denied', async () => {
    mockAuthenticatedUser(authGetUserMock)
    mockForbiddenPropertyAccess(validatePropertyAccessMock)

    const { POST } = await import('./route')
    const response = await POST(makeJsonRequest('http://localhost/api/competitors/intake', {
      body: { propertyId: 'property-1', rawText: 'Brookhaven by Century Communities (El Monte, CA). Notes.' },
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('POST stores parsed candidates as seeds and starts enrichment', async () => {
    mockAuthenticatedUser(authGetUserMock)
    mockGrantedPropertyAccess(validatePropertyAccessMock)

    let candidateInsertPayload: Array<Record<string, unknown>> = []
    const batchDeleteEqMock = vi.fn().mockResolvedValue({ error: null })
    const batchInsertMock = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'batch-1',
            property_id: 'property-1',
            submitted_by: 'user-1',
            raw_text: 'raw',
            status: 'pending',
            error_message: null,
            created_at: '2026-05-27T00:00:00.000Z',
            updated_at: '2026-05-27T00:00:00.000Z',
            completed_at: null,
          },
          error: null,
        }),
      })),
    }))
    const batchUpdateMock = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }))

    const candidatesInsertMock = vi.fn((payload: Array<Record<string, unknown>>) => {
      candidateInsertPayload = payload
      return {
        select: vi.fn().mockResolvedValue({
          data: payload.map((entry, idx) => ({
            id: `candidate-${idx + 1}`,
            competitor_id: null,
            error_message: null,
            created_at: '2026-05-27T00:00:00.000Z',
            updated_at: '2026-05-27T00:00:00.000Z',
            ...entry,
          })),
          error: null,
        }),
      }
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'competitor_intake_batches') {
          return {
            insert: batchInsertMock,
            update: batchUpdateMock,
            delete: vi.fn(() => ({ eq: batchDeleteEqMock })),
          }
        }
        if (table === 'competitor_intake_candidates') {
          return { insert: candidatesInsertMock }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const response = await POST(makeJsonRequest('http://localhost/api/competitors/intake', {
      body: {
        propertyId: 'property-1',
        rawText: 'Brookhaven by Century Communities (El Monte, CA 91733). Townhomes from $694,990, ranging 1,250 to 1,594 sq ft.',
      },
    }))

    expect(response.status).toBe(202)
    const json = await response.json()
    expect(json.batch.id).toBe('batch-1')
    expect(json.candidates).toHaveLength(1)
    expect(candidateInsertPayload[0]).toMatchObject({
      property_id: 'property-1',
      seed_name: 'Brookhaven',
      seed_location: 'El Monte, CA 91733',
      enrichment_status: 'pending',
      evidence_summary: {
        origin: 'client_provided_seed',
        canonical_truth: false,
      },
    })
    expect(global.fetch).toHaveBeenCalledWith(
      'http://data-engine.test/competitor-intake/enrich',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Key': 'engine-key' }),
      })
    )
  })

  it('GET returns 403 when property access is denied', async () => {
    mockAuthenticatedUser(authGetUserMock)
    mockForbiddenPropertyAccess(validatePropertyAccessMock)

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/competitors/intake?propertyId=property-1'))

    expect(response.status).toBe(403)
  })
})
