import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { getUserMock, managerAccessMock, confirmMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  managerAccessMock: vi.fn(),
  confirmMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyManagerAccess: managerAccessMock,
}))
vi.mock('@/utils/brandforge/imports', () => ({
  confirmBrandImport: confirmMock,
}))

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/brandforge/import/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'brand-confirm-test' },
    body: JSON.stringify(body),
  }) as NextRequest
}

const validBody = {
  propertyId: '11111111-1111-4111-8111-111111111111',
  importId: '22222222-2222-4222-8222-222222222222',
  contract: { contractVersion: '1.0' },
  resolutions: { identity: { name: 'Example Apartments' } },
}

describe('BrandForge import confirmation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({
      data: { user: { id: '33333333-3333-4333-8333-333333333333' } },
      error: null,
    })
    managerAccessMock.mockResolvedValue({ authorized: true })
    confirmMock.mockResolvedValue({
      brandAssetId: '44444444-4444-4444-8444-444444444444',
      contractHash: 'a'.repeat(64),
    })
  })

  it('requires manager authorization to approve imported truth', async () => {
    managerAccessMock.mockResolvedValue({ authorized: false })
    const { POST } = await import('./route')
    expect((await POST(request(validBody))).status).toBe(403)
  })

  it('returns conflict failures without publishing a revision', async () => {
    confirmMock.mockRejectedValue(new Error('Resolve import conflicts before approval: colors'))
    const { POST } = await import('./route')
    const response = await POST(request(validBody))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('Resolve import conflicts')
  })

  it('returns blocked asset-rights failures as conflicts', async () => {
    confirmMock.mockRejectedValue(new Error('Brand references unapproved or rights-blocked assets'))
    const { POST } = await import('./route')
    expect((await POST(request(validBody))).status).toBe(409)
  })

  it('publishes the approved canonical brand revision', async () => {
    const { POST } = await import('./route')
    const response = await POST(request(validBody))
    expect(response.status).toBe(200)
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: validBody.propertyId,
      importId: validBody.importId,
      userId: '33333333-3333-4333-8333-333333333333',
    }))
  })
})
