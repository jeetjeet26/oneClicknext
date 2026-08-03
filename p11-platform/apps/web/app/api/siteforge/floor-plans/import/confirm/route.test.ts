import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  getUserMock,
  validatePropertyAccessMock,
  importSingleMock,
  confirmImportMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
  importSingleMock: vi.fn(),
  confirmImportMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => {
    const builder: Record<string, unknown> = {}
    builder.select = vi.fn(() => builder)
    builder.eq = vi.fn(() => builder)
    builder.single = importSingleMock
    return { from: vi.fn(() => builder) }
  }),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))
vi.mock('@/utils/siteforge/providers/floor-plan-repository', () => ({
  confirmFloorPlanImport: confirmImportMock,
}))

function request(): NextRequest {
  return new Request(
    'http://localhost/api/siteforge/floor-plans/import/confirm',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId: '11111111-1111-4111-8111-111111111111',
        importId: '22222222-2222-4222-8222-222222222222',
      }),
    }
  ) as NextRequest
}

describe('floor-plan import confirmation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({
      data: { user: { id: '33333333-3333-4333-8333-333333333333' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    importSingleMock.mockResolvedValue({
      data: {
        id: '22222222-2222-4222-8222-222222222222',
        property_id: '11111111-1111-4111-8111-111111111111',
        status: 'preview',
        error_count: 0,
      },
      error: null,
    })
    confirmImportMock.mockResolvedValue({ applied: 2 })
  })

  it('blocks confirmation when preview errors remain', async () => {
    importSingleMock.mockResolvedValue({
      data: {
        id: '22222222-2222-4222-8222-222222222222',
        property_id: '11111111-1111-4111-8111-111111111111',
        status: 'preview',
        error_count: 1,
      },
      error: null,
    })
    const { POST } = await import('./route')
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(confirmImportMock).not.toHaveBeenCalled()
  })

  it('atomically confirms an error-free preview', async () => {
    const { POST } = await import('./route')
    const response = await POST(request())
    await expect(response.json()).resolves.toEqual({
      success: true,
      importId: '22222222-2222-4222-8222-222222222222',
      applied: 2,
    })
    expect(response.status).toBe(200)
    expect(confirmImportMock).toHaveBeenCalledOnce()
  })
})
