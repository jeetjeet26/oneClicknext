import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { PhotoManifest } from '@/utils/siteforge/agents/photo-agent'
import { persistSiteForgeAssets } from './repository'

function existingAssetClient(sourceOverrides: Record<string, unknown> = {}) {
  const bytes = new TextEncoder().encode('immutable image bytes')
  const byteSha256 = createHash('sha256').update(bytes).digest('hex')
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.in = vi.fn().mockResolvedValue({
    data: [{
      id: '33333333-3333-4333-8333-333333333333',
      property_id: '44444444-4444-4444-8444-444444444444',
      content_hash: 'c'.repeat(64),
      rights_status: 'owned',
      approval_status: 'approved',
      curation_status: 'selected',
      expires_at: null,
      duplicate_of: null,
      ...sourceOverrides,
    }],
    error: null,
  })
  builder.maybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: '22222222-2222-4222-8222-222222222222',
      byte_sha256: byteSha256,
      storage_path: `assets/${byteSha256}.jpg`,
    },
    error: null,
  })
  return {
    from: vi.fn(() => builder),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
      })),
    },
  }
}

describe('persistSiteForgeAssets', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses a deterministic identity and enriches every manifest projection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new TextEncoder().encode('immutable image bytes'), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        })
      )
    )
    const photo = {
      id: 'source-photo-1',
      sourceAssetId: '33333333-3333-4333-8333-333333333333',
      url: 'https://cdn.example.com/pool.jpg',
      type: 'uploaded' as const,
      category: 'amenity',
      quality: 8.5,
      scene: 'Resort-style pool with shaded seating',
    }
    const manifest: PhotoManifest = {
      photos: [photo],
      byCategory: {
        hero: [],
        amenities: [photo],
        lifestyle: [],
        gallery: [],
        logos: [],
      },
      assignments: { 'amenities-grid': photo.id },
      stats: {
        uploaded: 1,
        generated: 0,
        fromBrandForge: 0,
        total: 1,
      },
    }
    const client = existingAssetClient()

    const persisted = await persistSiteForgeAssets(
      '11111111-1111-4111-8111-111111111111',
      manifest,
      client as never
    )

    expect(persisted.photos[0]).toEqual(
      expect.objectContaining({
        assetId: '22222222-2222-4222-8222-222222222222',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        altText: 'Resort-style pool with shaded seating',
      })
    )
    expect(persisted.byCategory.amenities[0]?.contentHash).toBe(
      persisted.photos[0]?.contentHash
    )
  })

  it('refuses an approved asset that has not passed curation', async () => {
    const photo = {
      id: 'source-photo-1',
      sourceAssetId: '33333333-3333-4333-8333-333333333333',
      url: 'https://cdn.example.com/pool.jpg',
      type: 'uploaded' as const,
      category: 'amenity',
      quality: 8.5,
    }
    const manifest: PhotoManifest = {
      photos: [photo],
      byCategory: {
        hero: [],
        amenities: [photo],
        lifestyle: [],
        gallery: [],
        logos: [],
      },
      assignments: {},
      stats: {
        uploaded: 1,
        generated: 0,
        fromBrandForge: 0,
        total: 1,
      },
    }

    await expect(
      persistSiteForgeAssets(
        '11111111-1111-4111-8111-111111111111',
        manifest,
        existingAssetClient({ curation_status: 'needs_review' }) as never
      )
    ).rejects.toThrow('not approved and rights-cleared')
  })
})
