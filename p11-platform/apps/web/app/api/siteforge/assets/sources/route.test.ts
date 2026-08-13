import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authorizeAssetPropertyMock = vi.hoisted(() => vi.fn())
const createServiceClientMock = vi.hoisted(() => vi.fn())

vi.mock('@/utils/siteforge/assets/auth', () => ({
  authorizeAssetProperty: authorizeAssetPropertyMock,
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

const propertyId = '33333333-3333-3333-3333-333333333333'

describe('asset source routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated source listing', async () => {
    authorizeAssetPropertyMock.mockResolvedValue({
      status: 401,
      userId: null,
      orgId: null,
    })
    const request = new Request(
      `http://localhost/api/siteforge/assets/sources?propertyId=${propertyId}`
    ) as unknown as NextRequest
    Object.defineProperty(request, 'nextUrl', {
      value: new URL(request.url),
    })
    const { GET } = await import('./route')
    const response = await GET(request)

    expect(response.status).toBe(401)
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('never presents credential references or access tokens', async () => {
    const { presentAssetSource } = await import(
      '@/utils/siteforge/assets/source-presentation'
    )
    const presented = presentAssetSource({
      id: crypto.randomUUID(),
      org_id: crypto.randomUUID(),
      property_id: propertyId,
      website_id: null,
      provider: 'google_drive',
      status: 'active',
      external_folder_id: 'folder-1',
      external_folder_name: 'Photos',
      credential_ref: 'supabase-vault:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      scope_manifest: {},
      checkpoint: {},
      last_synced_at: null,
      last_error: null,
      created_by: null,
      created_at: '2026-08-10T00:00:00.000Z',
      updated_at: '2026-08-10T00:00:00.000Z',
    })

    expect(presented.hasCredential).toBe(true)
    expect(JSON.stringify(presented)).not.toContain('supabase-vault')
    expect(JSON.stringify(presented)).not.toContain('credential_ref')
  })
})
