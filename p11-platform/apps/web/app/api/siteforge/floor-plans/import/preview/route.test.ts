import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  getUserMock,
  validatePropertyAccessMock,
  createPreviewMock,
  propertySingleMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
  createPreviewMock: vi.fn(),
  propertySingleMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: propertySingleMock })),
      })),
    })),
  })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))
vi.mock('@/utils/siteforge/providers/floor-plan-repository', () => ({
  createFloorPlanImportPreview: createPreviewMock,
}))

function request(body: unknown): NextRequest {
  return new Request(
    'http://localhost/api/siteforge/floor-plans/import/preview',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  ) as NextRequest
}

describe('floor-plan import preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({
      data: { user: { id: '33333333-3333-4333-8333-333333333333' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    propertySingleMock.mockResolvedValue({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        org_id: '22222222-2222-4222-8222-222222222222',
      },
      error: null,
    })
    createPreviewMock.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      status: 'preview',
    })
  })

  it('requires authentication', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    const response = await POST(request({}))
    expect(response.status).toBe(401)
  })

  it('returns normalized rows and a confirmable durable preview', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      request({
        propertyId: '11111111-1111-4111-8111-111111111111',
        sourceType: 'manual',
        sourceIdentity: 'operator-entry',
        rows: [{ name: 'Aspen', bedrooms: 1, bathrooms: 1 }],
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(
      expect.objectContaining({
        importId: '44444444-4444-4444-8444-444444444444',
        canConfirm: true,
        errors: [],
      })
    )
    expect(createPreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'manual',
        sourceIdentity: 'operator-entry',
      }),
      expect.anything()
    )
  })
})
