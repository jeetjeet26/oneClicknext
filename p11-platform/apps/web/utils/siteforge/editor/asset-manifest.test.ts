import { describe, expect, it } from 'vitest'
import {
  assertApprovedAssetReferenceClosure,
  buildApprovedAssetManifest,
} from './asset-manifest'

const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)

describe('buildApprovedAssetManifest', () => {
  it('publishes approved assets in stable identity order with byte hashes', () => {
    const result = buildApprovedAssetManifest([
      {
        id: '00000000-0000-4000-8000-000000000002',
        asset_type: 'logo',
        source: 'upload',
        file_url: 'https://example.com/logo-b.png',
        storage_path: 'sites/logo-b.png',
        byte_sha256: DIGEST_B,
        content_hash: DIGEST_B,
        approval_status: 'approved',
        rights_status: 'owned',
      },
      {
        id: '00000000-0000-4000-8000-000000000001',
        asset_type: 'hero_image',
        source: 'generated',
        file_url: 'https://example.com/hero.png',
        storage_path: 'sites/hero.png',
        byte_sha256: DIGEST_A,
        content_hash: DIGEST_A,
        approval_status: 'approved',
        rights_status: 'generated',
      },
    ])

    expect(result.assetManifest).toMatchObject([
      {
        id: '00000000-0000-4000-8000-000000000001',
        byteSha256: DIGEST_A,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        byteSha256: DIGEST_B,
      },
    ])
    expect(result.assetManifestHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects assets without immutable bytes or rights approval', () => {
    expect(() =>
      buildApprovedAssetManifest([
        {
          id: '00000000-0000-4000-8000-000000000002',
          asset_type: 'logo',
          source: 'upload',
          file_url: 'https://example.com/logo-b.png',
          storage_path: 'sites/logo-b.png',
          byte_sha256: null,
          content_hash: null,
          approval_status: 'approved',
          rights_status: 'owned',
        },
      ])
    ).toThrow('has no immutable byte digest')
  })

  it('replaces logo A with only logo B in the next exact manifest', () => {
    const result = buildApprovedAssetManifest(
      [
        {
          id: '00000000-0000-4000-8000-000000000001',
          asset_type: 'logo',
          source: 'upload',
          file_url: 'https://example.com/logo-a.png',
          storage_path: 'sites/logo-a.png',
          byte_sha256: DIGEST_A,
          content_hash: DIGEST_A,
          approval_status: 'approved',
          rights_status: 'owned',
        },
        {
          id: '00000000-0000-4000-8000-000000000002',
          asset_type: 'logo',
          source: 'upload',
          file_url: 'https://example.com/logo-b.png',
          storage_path: 'sites/logo-b.png',
          byte_sha256: DIGEST_B,
          content_hash: DIGEST_B,
          approval_status: 'approved',
          rights_status: 'owned',
        },
      ],
      {
        siteConfiguration: {
          media: {
            logoAssetId: '00000000-0000-4000-8000-000000000002',
            logoUrl: 'https://example.com/logo-b.png',
          },
        },
      }
    )

    expect(result.assetManifest).toEqual([
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000002',
        byteSha256: DIGEST_B,
      }),
    ])
  })
})

describe('assertApprovedAssetReferenceClosure', () => {
  const approvedAssets = [
    {
      id: '00000000-0000-4000-8000-000000000002',
      asset_type: 'logo',
      source: 'upload',
      file_url: 'https://example.com/logo-b.png',
      storage_path: 'sites/logo-b.png',
      byte_sha256: DIGEST_B,
      content_hash: DIGEST_B,
      approval_status: 'approved',
      rights_status: 'owned',
    },
  ]

  it('accepts changed media when ID, URL, and digest close over a known asset', () => {
    expect(() =>
      assertApprovedAssetReferenceClosure({
        approvedAssets,
        originalBlueprint: {
          siteConfiguration: {
            media: {
              logoAssetId: '00000000-0000-4000-8000-000000000001',
              logoUrl: 'https://example.com/logo-a.png',
            },
          },
        },
        updatedBlueprint: {
          siteConfiguration: {
            media: {
              logoAssetId: '00000000-0000-4000-8000-000000000002',
              logoUrl: 'https://example.com/logo-b.png',
            },
          },
        },
      })
    ).not.toThrow()
  })

  it('rejects changed media with a missing ID or mismatched URL', () => {
    expect(() =>
      assertApprovedAssetReferenceClosure({
        approvedAssets,
        originalBlueprint: {},
        updatedBlueprint: {
          image: {
            url: 'https://evil.example/hero.png',
            alt: 'Hero',
          },
        },
      })
    ).toThrow('requires an approved asset ID')

    expect(() =>
      assertApprovedAssetReferenceClosure({
        approvedAssets,
        originalBlueprint: {},
        updatedBlueprint: {
          image: {
            assetId: '00000000-0000-4000-8000-000000000002',
            url: 'https://evil.example/logo.png',
            alt: 'Logo',
          },
        },
      })
    ).toThrow('not closed over a known immutable asset')
  })

  it('allows unchanged legacy media while blocking unsafe new edits', () => {
    const legacy = {
      image: { url: 'https://legacy.example/hero.png', alt: 'Hero' },
    }
    expect(() =>
      assertApprovedAssetReferenceClosure({
        approvedAssets,
        originalBlueprint: legacy,
        updatedBlueprint: legacy,
      })
    ).not.toThrow()
  })

  it('treats page reordering as unchanged legacy media', () => {
    const home = {
      slug: 'home',
      sections: [
        {
          content: {
            floor_plans: [
              {
                image_url: 'https://legacy.example/floor-plan.png',
              },
            ],
          },
        },
      ],
    }
    const amenities = { slug: 'amenities', sections: [] }
    expect(() =>
      assertApprovedAssetReferenceClosure({
        approvedAssets,
        originalBlueprint: { pages: [home, amenities] },
        updatedBlueprint: { pages: [amenities, home] },
      })
    ).not.toThrow()

    expect(() =>
      assertApprovedAssetReferenceClosure({
        approvedAssets,
        originalBlueprint: { pages: [home] },
        updatedBlueprint: { pages: [home, structuredClone(home)] },
      })
    ).toThrow('requires an approved asset ID')
  })
})
