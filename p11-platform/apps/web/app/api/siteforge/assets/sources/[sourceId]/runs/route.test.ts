import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authorizeAssetPropertyMock = vi.hoisted(() => vi.fn())
const createServiceClientMock = vi.hoisted(() => vi.fn())
const runAssetSourceIngestionMock = vi.hoisted(() => vi.fn())

vi.mock('@/utils/siteforge/assets/auth', () => ({
  authorizeAssetProperty: authorizeAssetPropertyMock,
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/utils/siteforge/assets/source-ingestion', () => ({
  runAssetSourceIngestion: runAssetSourceIngestionMock,
}))

const propertyId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const sourceId = '33333333-3333-4333-8333-333333333333'

function postRequest() {
  return new Request(
    `http://localhost/api/siteforge/assets/sources/${sourceId}/runs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId }),
    }
  ) as unknown as NextRequest
}

function sourceService() {
  const source = {
    id: sourceId,
    org_id: orgId,
    property_id: propertyId,
    website_id: null,
    provider: 'dropbox',
    status: 'active',
    external_folder_id: '/photos',
    external_folder_name: 'Photos',
    credential_ref: 'env:SITEFORGE_ASSET_DROPBOX_TEST',
    scope_manifest: {},
    checkpoint: { cursor: 'durable-cursor' },
    last_synced_at: null,
    last_error: null,
    created_by: 'user-1',
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
  }
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({ data: source, error: null })
  return { from: vi.fn(() => builder), source }
}

describe('asset source run route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authorizeAssetPropertyMock.mockResolvedValue({
      status: 200,
      userId: 'user-1',
      orgId,
    })
  })

  it('requires manager authorization before loading a source', async () => {
    authorizeAssetPropertyMock.mockResolvedValue({
      status: 403,
      userId: 'user-1',
      orgId: null,
    })
    const { POST } = await import('./route')
    const response = await POST(postRequest(), {
      params: Promise.resolve({ sourceId }),
    })

    expect(response.status).toBe(403)
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('fails closed on provider errors and retains the persisted checkpoint', async () => {
    const service = sourceService()
    createServiceClientMock.mockReturnValue(service)
    runAssetSourceIngestionMock.mockRejectedValue(
      new Error('Dropbox request failed (503)')
    )
    const { POST } = await import('./route')
    const response = await POST(postRequest(), {
      params: Promise.resolve({ sourceId }),
    })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'Dropbox request failed (503)',
    })
    expect(runAssetSourceIngestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          checkpoint: { cursor: 'durable-cursor' },
        }),
      })
    )
  })
})
