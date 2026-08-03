import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  getUserMock,
  profileSingleMock,
  validatePropertyAccessMock,
  serviceFromMock,
  waiverInsertMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  profileSingleMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
  serviceFromMock: vi.fn(),
  waiverInsertMock: vi.fn(),
}))

function query(result: unknown) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.insert = vi.fn((value: unknown) => {
    waiverInsertMock(value)
    return builder
  })
  builder.single = vi.fn(async () => result)
  return builder
}

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => {
    const profileQuery = query(null)
    profileQuery.single = profileSingleMock
    return {
      auth: { getUser: getUserMock },
      from: vi.fn(() => profileQuery),
    }
  }),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({ from: serviceFromMock })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

const propertyId = '11111111-1111-4111-8111-111111111111'
const websiteId = '22222222-2222-4222-8222-222222222222'
const artifactId = '33333333-3333-4333-8333-333333333333'

function request(checkCode = 'performance.lighthouse_mobile_budget'): NextRequest {
  return new Request('http://localhost/api/siteforge/certification/waivers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      propertyId,
      websiteId,
      artifactId,
      checkCode,
      rationale: 'A documented provider incident requires a short exception.',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      evidence: { incident: 'INC-42' },
    }),
  }) as NextRequest
}

describe('certification waiver route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({
      data: { user: { id: '55555555-5555-4555-8555-555555555555' } },
      error: null,
    })
    profileSingleMock.mockResolvedValue({
      data: { role: 'manager' },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    serviceFromMock.mockImplementation((table: string) => {
      if (table === 'property_websites') {
        return query({
          data: {
            id: websiteId,
            org_id: '44444444-4444-4444-8444-444444444444',
            property_id: propertyId,
          },
          error: null,
        })
      }
      if (table === 'siteforge_blueprint_versions') {
        return query({ data: { id: artifactId }, error: null })
      }
      return query({
        data: {
          id: '66666666-6666-4666-8666-666666666666',
          check_code: 'performance.lighthouse_mobile_budget',
          policy_version: 'siteforge-browser-certification-v3',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
          created_at: new Date().toISOString(),
        },
        error: null,
      })
    })
  })

  it('requires manager or admin authorization', async () => {
    profileSingleMock.mockResolvedValue({
      data: { role: 'viewer' },
      error: null,
    })
    const { POST } = await import('./route')
    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(waiverInsertMock).not.toHaveBeenCalled()
  })

  it('creates an immutable waiver for the exact tenant artifact', async () => {
    const { POST } = await import('./route')
    const response = await POST(request())

    expect(response.status).toBe(201)
    expect(waiverInsertMock).toHaveBeenCalledWith(expect.objectContaining({
      property_id: propertyId,
      website_id: websiteId,
      artifact_id: artifactId,
      approved_by: '55555555-5555-4555-8555-555555555555',
      evidence: expect.objectContaining({ immutable: true }),
    }))
  })

  it('forbids legal and critical accessibility waivers', async () => {
    const { POST } = await import('./route')
    const response = await POST(request('browser:accessibility.critical_axe'))

    expect(response.status).toBe(422)
    expect(waiverInsertMock).not.toHaveBeenCalled()
  })
})
