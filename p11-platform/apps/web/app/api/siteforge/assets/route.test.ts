import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authorizeAssetPropertyMock = vi.hoisted(() => vi.fn())
const createServiceClientMock = vi.hoisted(() => vi.fn())
const uploadFileAssetMock = vi.hoisted(() => vi.fn())
const analyzeImageContentMock = vi.hoisted(() => vi.fn())

vi.mock('@/utils/siteforge/assets/auth', () => ({
  authorizeAssetProperty: authorizeAssetPropertyMock,
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/utils/storage/asset-service', () => ({
  STORAGE_BUCKETS: { PROPERTY_ASSETS: 'property-assets' },
  uploadFileAsset: uploadFileAssetMock,
}))
vi.mock('@/utils/siteforge/assets/image-analysis', () => ({
  analyzeImageContent: analyzeImageContentMock,
}))

const propertyId = '11111111-2222-4333-8444-555555555555'
const assetId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function pngFile(name = 'rooftop.png') {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    name,
    { type: 'image/png' }
  )
}

function uploadRequest(file = pngFile()) {
  const formData = new FormData()
  formData.set('propertyId', propertyId)
  formData.set('category', 'amenity')
  formData.set('file', file)
  return new Request('http://localhost/api/siteforge/assets', {
    method: 'POST',
    body: formData,
  }) as unknown as NextRequest
}

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: assetId,
    file_url: 'https://cdn.example.com/rooftop.png',
    thumbnail_url: null,
    name: 'rooftop.png',
    description: null,
    file_size_bytes: 8,
    format: 'image/png',
    width: 1200,
    height: 800,
    asset_type: 'image',
    asset_role: 'amenity',
    alt_text: 'Rooftop amenity terrace',
    approval_status: 'pending',
    curation_status: 'needs_review',
    rights_status: 'unknown',
    rights_metadata: {},
    expires_at: null,
    source_identity: 'siteforge-upload:rooftop.png',
    source_metadata: {},
    content_hash: 'a'.repeat(64),
    duplicate_of: null,
    focal_point: null,
    crop_suggestion: null,
    quality_score: 0.8,
    hero_rank: null,
    usage_manifest: [],
    analyzed_at: '2026-08-10T00:00:00.000Z',
    created_at: '2026-08-10T00:00:00.000Z',
    ...overrides,
  }
}

function uploadService(duplicate: Record<string, unknown> | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: duplicate, error: null })
  const single = vi
    .fn()
    .mockResolvedValue({ data: assetRow(), error: null })
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.is = vi.fn(() => builder)
  builder.maybeSingle = maybeSingle
  builder.insert = vi.fn(() => ({
    select: vi.fn(() => ({ single })),
  }))
  builder.update = vi.fn((payload: Record<string, unknown>) => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: assetRow(payload),
            error: null,
          }),
        })),
      })),
    })),
  }))
  const remove = vi.fn().mockResolvedValue({ error: null })
  return {
    client: {
      from: vi.fn(() => builder),
      storage: { from: vi.fn(() => ({ remove })) },
    },
    builder,
  }
}

describe('SiteForge asset route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeAssetPropertyMock.mockResolvedValue({
      status: 200,
      userId: 'user-1',
      orgId: '99999999-9999-4999-8999-999999999999',
    })
    uploadFileAssetMock.mockResolvedValue({
      success: true,
      publicUrl: 'https://cdn.example.com/rooftop.png',
      storagePath: `${propertyId}/siteforge/amenity/rooftop.png`,
      fileSize: 8,
    })
    analyzeImageContentMock.mockResolvedValue({
      mode: 'visual_ai',
      model: 'anthropic/test',
      visualClaims: true,
      suggestedRole: 'amenity',
      altText: 'Rooftop amenity terrace',
      focalPoint: { x: 0.5, y: 0.5 },
      cropSuggestion: null,
      qualityScore: 0.8,
      observedElements: ['terrace'],
      qualityNotes: ['sharp'],
      metadata: {
        contentHash: 'a'.repeat(64),
        byteLength: 8,
        mediaType: 'image/png',
        width: 1200,
        height: 800,
      },
    })
  })

  it('rejects unauthenticated uploads before analysis or storage', async () => {
    authorizeAssetPropertyMock.mockResolvedValue({
      status: 401,
      userId: null,
      orgId: null,
    })
    const { POST } = await import('./route')
    const response = await POST(uploadRequest())

    expect(response.status).toBe(401)
    expect(analyzeImageContentMock).not.toHaveBeenCalled()
    expect(uploadFileAssetMock).not.toHaveBeenCalled()
  })

  it('immediately trusts direct SiteForge photo uploads with audit metadata', async () => {
    const service = uploadService()
    createServiceClientMock.mockReturnValue(service.client)
    const { POST } = await import('./route')
    const response = await POST(uploadRequest())

    expect(response.status).toBe(201)
    expect(analyzeImageContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: expect.any(Uint8Array),
        mediaType: 'image/png',
      })
    )
    expect(service.builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        property_id: propertyId,
        content_hash: 'a'.repeat(64),
        curation_status: 'approved',
        approval_status: 'approved',
        rights_status: 'owned',
        expires_at: null,
        approved_by: 'user-1',
        approved_at: expect.any(String),
        rights_metadata: expect.objectContaining({
          siteforgeTrustPolicy: {
            name: 'siteforge-solo-operator-photo-trust',
            version: '1',
          },
          siteforgeTrustEvents: [
            expect.objectContaining({
              approvedBy: 'user-1',
              intake: 'direct_upload',
              importSource: 'siteforge',
              contentHash: 'a'.repeat(64),
            }),
          ],
        }),
        quality_score: 0.8,
      })
    )
  })

  it('returns the existing asset for duplicate content without uploading', async () => {
    const duplicate = assetRow({
      approval_status: 'approved',
      curation_status: 'selected',
      rights_status: 'owned',
    })
    const service = uploadService(duplicate)
    createServiceClientMock.mockReturnValue(service.client)
    const { POST } = await import('./route')
    const response = await POST(uploadRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      duplicate: true,
      asset: { id: assetId, usable: true },
    })
    expect(uploadFileAssetMock).not.toHaveBeenCalled()
    expect(service.builder.insert).not.toHaveBeenCalled()
    expect(service.builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        rights_status: 'owned',
        approval_status: 'approved',
        curation_status: 'selected',
        expires_at: null,
      })
    )
  })

  it('does not promote a duplicate BrandForge logo into a trusted photo', async () => {
    const duplicate = assetRow({
      asset_type: 'image',
      asset_role: 'primary_logo',
      source_identity: 'brandforge:logo',
    })
    const service = uploadService(duplicate)
    createServiceClientMock.mockReturnValue(service.client)
    const { POST } = await import('./route')
    const response = await POST(uploadRequest())

    expect(response.status).toBe(409)
    expect(service.builder.update).not.toHaveBeenCalled()
    expect(uploadFileAssetMock).not.toHaveBeenCalled()
  })

  it('requires manager authorization for batch curation', async () => {
    authorizeAssetPropertyMock.mockResolvedValue({
      status: 403,
      userId: 'user-1',
      orgId: null,
    })
    const request = new Request('http://localhost/api/siteforge/assets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId,
        updates: [
          {
            assetId,
            approvalStatus: 'approved',
            curationStatus: 'approved',
            rightsStatus: 'owned',
          },
        ],
      }),
    }) as unknown as NextRequest
    const { PATCH } = await import('./route')
    const response = await PATCH(request)

    expect(response.status).toBe(403)
    expect(authorizeAssetPropertyMock).toHaveBeenCalledWith(propertyId, {
      manager: true,
    })
  })
})
