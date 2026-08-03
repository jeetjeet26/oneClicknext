import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const { getUserMock, accessMock, previewMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  accessMock: vi.fn(),
  previewMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: accessMock,
}))
vi.mock('@/utils/brandforge/imports', () => ({
  createBrandImportPreview: previewMock,
}))

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/brandforge/import/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'brand-preview-test' },
    body: JSON.stringify(body),
  }) as NextRequest
}

const validBody = {
  propertyId: '11111111-1111-4111-8111-111111111111',
  sourceType: 'hybrid',
  idempotencyKey: 'brand-import-test',
  websiteUrl: 'https://example.com',
  manual: { identity: { name: 'Example Apartments' } },
}

describe('BrandForge import preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({
      data: { user: { id: '22222222-2222-4222-8222-222222222222' } },
      error: null,
    })
    accessMock.mockResolvedValue({
      authorized: true,
      orgId: '33333333-3333-4333-8333-333333333333',
    })
    previewMock.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      status: 'needs_review',
      conflicts: [{ field: 'identity', candidates: [] }],
    })
  })

  it('requires authentication', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    expect((await POST(request(validBody))).status).toBe(401)
  })

  it('rejects malformed extraction requests without a source', async () => {
    const { POST } = await import('./route')
    const response = await POST(request({
      ...validBody,
      websiteUrl: undefined,
      manual: undefined,
    }))
    expect(response.status).toBe(400)
    expect(previewMock).not.toHaveBeenCalled()
  })

  it('enforces property authorization', async () => {
    accessMock.mockResolvedValue({ authorized: false, orgId: null })
    const { POST } = await import('./route')
    expect((await POST(request(validBody))).status).toBe(403)
  })

  it('persists an evidence-backed preview with the tenant identity', async () => {
    const { POST } = await import('./route')
    const response = await POST(request(validBody))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.preview.status).toBe('needs_review')
    expect(previewMock).toHaveBeenCalledWith(expect.objectContaining({
      orgId: '33333333-3333-4333-8333-333333333333',
      userId: '22222222-2222-4222-8222-222222222222',
      sourceType: 'hybrid',
    }))
  })
})
