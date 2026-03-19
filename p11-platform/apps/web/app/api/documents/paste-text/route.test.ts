import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
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

vi.mock('openai', () => ({
  default: class MockOpenAI {
    embeddings = {
      create: embeddingsCreateMock,
    }
  },
}))

describe('documents paste-text route auth', () => {
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
      new Request('http://localhost/api/documents/paste-text', {
        method: 'POST',
        body: JSON.stringify({
          content: 'This is valid content long enough to pass the minimum size requirement for processing.',
          propertyId: 'property-1',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/documents/paste-text', {
        method: 'POST',
        body: JSON.stringify({
          content: 'This is valid content long enough to pass the minimum size requirement for processing.',
          propertyId: 'property-1',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('cleans up inserted chunks when knowledge source upsert fails', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
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
    const sourceSelectMatchUrlIsMock = vi.fn().mockReturnValue({ maybeSingle: sourceMaybeSingleMock })
    const sourceSelectAfterSourceName = { is: sourceSelectMatchUrlIsMock }
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

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/documents/paste-text', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Resident FAQ',
          content:
            'This is valid content long enough to pass the minimum size requirement for processing and trigger chunk creation for cleanup testing.',
          propertyId: 'property-1',
        }),
      }) as NextRequest
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to create knowledge source record for pasted text',
    })
    expect(documentsDeleteMock).toHaveBeenCalled()
    expect(documentsDeletePropertyEqMock).toHaveBeenCalledWith('property_id', 'property-1')
    expect(documentsDeleteRunEqMock).toHaveBeenCalledWith(
      'metadata->>ingestion_run_id',
      expect.any(String)
    )
  })
})
