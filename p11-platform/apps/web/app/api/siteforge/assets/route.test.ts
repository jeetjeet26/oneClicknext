import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const uploadFileAssetMock = vi.fn()
const insertMock = vi.fn()
const singleMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/storage/asset-service', () => ({
  STORAGE_BUCKETS: { PROPERTY_ASSETS: 'property-assets' },
  uploadFileAsset: uploadFileAssetMock,
}))

const propertyId = '11111111-2222-3333-4444-555555555555'

function pngFile(name = 'rooftop.png') {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    name,
    { type: 'image/png' }
  )
}

function uploadRequest(options?: {
  file?: File
  category?: string
  propertyId?: string
}) {
  const formData = new FormData()
  formData.set('propertyId', options?.propertyId || propertyId)
  formData.set('category', options?.category || 'amenity')
  formData.set('file', options?.file || pngFile())
  return new Request('http://localhost/api/siteforge/assets', {
    method: 'POST',
    body: formData,
  }) as unknown as NextRequest
}

describe('SiteForge property assets route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: '99999999-9999-4999-8999-999999999999',
    })
    uploadFileAssetMock.mockResolvedValue({
      success: true,
      publicUrl:
        'https://example.supabase.co/storage/v1/object/public/property-assets/photo.png',
      storagePath: `${propertyId}/siteforge/amenity/photo.png`,
      fileSize: 8,
    })
    singleMock.mockResolvedValue({
      data: {
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        file_url:
          'https://example.supabase.co/storage/v1/object/public/property-assets/photo.png',
        name: 'rooftop.png',
        file_size_bytes: 8,
        format: 'image/png',
        asset_role: 'amenity',
        alt_text: 'rooftop',
        approval_status: 'pending',
        rights_status: 'unknown',
        created_at: '2026-07-31T00:00:00.000Z',
      },
      error: null,
    })
    insertMock.mockReturnValue({
      select: vi.fn(() => ({ single: singleMock })),
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({ insert: insertMock })),
      storage: {
        from: vi.fn(() => ({ remove: vi.fn().mockResolvedValue({ error: null }) })),
      },
    })
  })

  it('rejects unauthenticated property uploads', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })
    const { POST } = await import('./route')
    const response = await POST(uploadRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(uploadFileAssetMock).not.toHaveBeenCalled()
  })

  it('rejects files whose bytes do not match their image type', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      uploadRequest({
        file: new File(['not a png'], 'fake.png', { type: 'image/png' }),
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'The uploaded file does not contain a valid image',
    })
    expect(uploadFileAssetMock).not.toHaveBeenCalled()
  })

  it('stores a categorized photo pending rights review', async () => {
    const { POST } = await import('./route')
    const response = await POST(uploadRequest())

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      asset: {
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        category: 'amenity',
        altText: 'rooftop',
        approvalStatus: 'pending',
        rightsStatus: 'unknown',
      },
    })
    expect(uploadFileAssetMock).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        bucket: 'property-assets',
        propertyId,
        folder: 'siteforge/amenity',
        contentType: 'image/png',
        upsert: false,
      })
    )
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        property_id: propertyId,
        asset_type: 'image',
        asset_role: 'amenity',
        approval_status: 'pending',
        rights_status: 'unknown',
      })
    )
  })

  it('keeps uploaded floor-plan layouts out of the property photo pool', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      uploadRequest({ category: 'floorplan', file: pngFile('a1.png') })
    )

    expect(response.status).toBe(201)
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        asset_type: 'image',
        asset_role: 'floorplan',
        approval_status: 'pending',
      })
    )
  })
})
