import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const uploadFileAssetMock = vi.fn()
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

vi.mock('@/utils/storage', () => ({
  uploadFileAsset: uploadFileAssetMock,
  STORAGE_BUCKETS: {
    DOCUMENTS: 'documents',
  },
  getMimeTypeFromExtension: vi.fn().mockReturnValue('text/plain'),
}))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    embeddings = {
      create: embeddingsCreateMock,
    }
  },
}))

describe('documents upload route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/documents/upload', {
        method: 'POST',
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const formData = new FormData()
    formData.append('propertyId', 'property-1')
    formData.append(
      'file',
      new Blob(['This is a valid test document content that exceeds fifty characters.'], { type: 'text/plain' }),
      'test.txt'
    )

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/documents/upload', {
        method: 'POST',
        body: formData,
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('creates a knowledge source record for successful uploads', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    uploadFileAssetMock.mockResolvedValue({
      success: true,
      publicUrl: 'https://storage.example/doc.txt',
      storagePath: 'documents/property-1/uploads/doc.txt',
    })
    embeddingsCreateMock.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    })

    const documentsInsertMock = vi.fn().mockResolvedValue({ error: null })
    const sourceMaybeSingleMock = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const sourceSelectMatchUrlEqMock = vi.fn().mockReturnValue({ maybeSingle: sourceMaybeSingleMock })
    const sourceSelectMatchUrlIsMock = vi.fn().mockReturnValue({ maybeSingle: sourceMaybeSingleMock })
    const sourceSelectAfterSourceName = {
      eq: sourceSelectMatchUrlEqMock,
      is: sourceSelectMatchUrlIsMock,
    }
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

    const fromMock = vi.fn((table: string) => {
      if (table === 'documents') {
        return { insert: documentsInsertMock }
      }
      if (table === 'knowledge_sources') {
        return {
          select: sourceSelectMock,
          insert: sourceInsertMock,
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })
    createServiceClientMock.mockReturnValue({ from: fromMock })

    const formData = new FormData()
    formData.append('propertyId', 'property-1')
    formData.append('title', 'Doc Title')
    formData.append(
      'file',
      new Blob(['This is a valid test document content that exceeds fifty characters.'], { type: 'text/plain' }),
      'doc.txt'
    )

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/documents/upload', {
        method: 'POST',
        body: formData,
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    expect(fromMock).toHaveBeenCalledWith('knowledge_sources')
    expect(sourceInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'document',
        extracted_data: expect.objectContaining({
          brand_origin: 'client_provided_material',
        }),
      })
    )
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      knowledgeSourceId: 'source-1',
    })
  })

  it('cleans up inserted chunks when knowledge source upsert fails', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    uploadFileAssetMock.mockResolvedValue({
      success: true,
      publicUrl: 'https://storage.example/doc.txt',
      storagePath: 'documents/property-1/uploads/doc.txt',
    })
    embeddingsCreateMock.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    })

    const documentsInsertMock = vi.fn().mockResolvedValue({ error: null })
    const documentsDeleteRunEqMock = vi.fn().mockResolvedValue({ error: null })
    const documentsDeletePropertyEqMock = vi.fn().mockReturnValue({ eq: documentsDeleteRunEqMock })
    const documentsDeleteMock = vi.fn().mockReturnValue({ eq: documentsDeletePropertyEqMock })
    const sourceMaybeSingleMock = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const sourceSelectMatchUrlEqMock = vi.fn().mockReturnValue({ maybeSingle: sourceMaybeSingleMock })
    const sourceSelectMatchUrlIsMock = vi.fn().mockReturnValue({ maybeSingle: sourceMaybeSingleMock })
    const sourceSelectAfterSourceName = {
      eq: sourceSelectMatchUrlEqMock,
      is: sourceSelectMatchUrlIsMock,
    }
    const sourceSelectMatchSourceTypeEqMock = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockReturnValue(sourceSelectAfterSourceName) })
    const sourceSelectMock = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: sourceSelectMatchSourceTypeEqMock }) })
    const sourceInsertMock = vi.fn().mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: null, error: new Error('boom') }),
      })),
    })

    const fromMock = vi.fn((table: string) => {
      if (table === 'documents') {
        return {
          insert: documentsInsertMock,
          delete: documentsDeleteMock,
        }
      }
      if (table === 'knowledge_sources') {
        return {
          select: sourceSelectMock,
          insert: sourceInsertMock,
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })
    createServiceClientMock.mockReturnValue({ from: fromMock })

    const formData = new FormData()
    formData.append('propertyId', 'property-1')
    formData.append('title', 'Doc Title')
    formData.append(
      'file',
      new Blob(['This is a valid test document content that exceeds fifty characters.'], { type: 'text/plain' }),
      'doc.txt'
    )

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/documents/upload', {
        method: 'POST',
        body: formData,
      }) as NextRequest
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to create knowledge source record for uploaded document',
    })
    expect(documentsDeleteMock).toHaveBeenCalled()
    expect(documentsDeletePropertyEqMock).toHaveBeenCalledWith('property_id', 'property-1')
    expect(documentsDeleteRunEqMock).toHaveBeenCalledWith(
      'metadata->>ingestion_run_id',
      expect.any(String)
    )
  })
})
