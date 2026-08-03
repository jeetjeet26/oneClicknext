import { describe, expect, it } from 'vitest'
import { buildApprovedAssetManifest } from './asset-manifest'

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
