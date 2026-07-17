import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const adminLimiterCheckMock = vi.fn()
const getRateLimitKeyMock = vi.fn()
const rateLimitHeadersMock = vi.fn()
const auditLogMock = vi.fn()
const getRequestIpMock = vi.fn()
const uploadFileAssetMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/rate-limiter', () => ({
  adminLimiter: {
    check: adminLimiterCheckMock,
  },
  getRateLimitKey: getRateLimitKeyMock,
  rateLimitHeaders: rateLimitHeadersMock,
}))

vi.mock('@/utils/services/audit-logger', () => ({
  auditLog: auditLogMock,
  getRequestIp: getRequestIpMock,
}))

vi.mock('@/utils/storage/asset-service', () => ({
  uploadFileAsset: uploadFileAssetMock,
  STORAGE_BUCKETS: {
    BRAND_ASSETS: 'brand-assets',
    CONTENT_ASSETS: 'content-assets',
    PROPERTY_ASSETS: 'property-assets',
    DOCUMENTS: 'documents',
  },
}))

const PROPERTY_ID = '11111111-2222-3333-4444-555555555555'

function buildUploadRequest(options?: {
  propertyId?: string | null
  file?: File | null
}): NextRequest {
  const formData = new FormData()
  const propertyId = options?.propertyId === undefined ? PROPERTY_ID : options.propertyId
  if (propertyId !== null) {
    formData.append('propertyId', propertyId)
  }
  const file =
    options?.file === undefined
      ? new File([new Uint8Array([1, 2, 3, 4])], 'logo.png', { type: 'image/png' })
      : options.file
  if (file !== null) {
    formData.append('file', file)
  }

  return new Request('http://localhost/api/lumaleasing/admin/logo', {
    method: 'POST',
    body: formData,
  }) as unknown as NextRequest
}

describe('Luma admin logo upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    getRateLimitKeyMock.mockReturnValue('admin-logo-key')
    adminLimiterCheckMock.mockReturnValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({})
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })
    auditLogMock.mockImplementation(() => {})
    getRequestIpMock.mockReturnValue('127.0.0.1')
    uploadFileAssetMock.mockResolvedValue({
      success: true,
      publicUrl: 'https://cdn.example.com/brand-assets/logo.png',
      storagePath: `${PROPERTY_ID}/lumaleasing/logo.png`,
      fileSize: 4,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
    })

    const { POST } = await import('./route')
    const response = await POST(buildUploadRequest())

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(uploadFileAssetMock).not.toHaveBeenCalled()
  })

  it('returns 429 when rate limited', async () => {
    adminLimiterCheckMock.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterMs: 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({ 'Retry-After': '60' })

    const { POST } = await import('./route')
    const response = await POST(buildUploadRequest())

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(uploadFileAssetMock).not.toHaveBeenCalled()
  })

  it('returns 400 when property id is missing or invalid', async () => {
    const { POST } = await import('./route')
    const response = await POST(buildUploadRequest({ propertyId: 'not-a-uuid' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Valid property ID required' })
    expect(uploadFileAssetMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the file is missing', async () => {
    const { POST } = await import('./route')
    const response = await POST(buildUploadRequest({ file: null }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Image file required' })
    expect(uploadFileAssetMock).not.toHaveBeenCalled()
  })

  it('returns 400 for unsupported file types', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      buildUploadRequest({
        file: new File(['not-an-image'], 'logo.pdf', { type: 'application/pdf' }),
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported file type. Use PNG, JPG, GIF, WebP, or SVG.',
    })
    expect(uploadFileAssetMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the file exceeds the size limit', async () => {
    const oversized = new File(
      [new Uint8Array(2 * 1024 * 1024 + 1)],
      'logo.png',
      { type: 'image/png' }
    )

    const { POST } = await import('./route')
    const response = await POST(buildUploadRequest({ file: oversized }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Logo must be 2MB or smaller' })
    expect(uploadFileAssetMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the user has no access to the property', async () => {
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { POST } = await import('./route')
    const response = await POST(buildUploadRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(uploadFileAssetMock).not.toHaveBeenCalled()
  })

  it('uploads the logo to the brand-assets bucket and returns its public URL', async () => {
    const { POST } = await import('./route')
    const response = await POST(buildUploadRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({ url: 'https://cdn.example.com/brand-assets/logo.png' })
    expect(uploadFileAssetMock).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({
        bucket: 'brand-assets',
        propertyId: PROPERTY_ID,
        folder: 'lumaleasing',
        contentType: 'image/png',
      })
    )
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'config_updated', resource: 'admin/logo' })
    )
  })

  it('returns a sanitized 500 when the storage upload fails', async () => {
    uploadFileAssetMock.mockResolvedValue({
      success: false,
      error: 'bucket exploded',
    })

    const { POST } = await import('./route')
    const response = await POST(buildUploadRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
