import { describe, expect, it } from 'vitest'
import { normalizeBrandForgeContract } from '@/utils/brandforge/normalize'
import {
  bindApprovedBrandLogos,
  brandContextFromContract,
} from './brand-contract-adapter'

function auroraContract() {
  return normalizeBrandForgeContract(
    {
      section_5_name_story: { name: 'Aurora', tagline: 'Live brighter' },
      section_6_logo: {
        primary_url:
          'HTTPS://CDN.EXAMPLE.COM:443/aurora/logo.svg?width=800&format=svg#brand',
        logoVariations: [
          'https://cdn.example.com/aurora/logo.svg?format=svg&width=800',
          'https://cdn.example.com/aurora/unknown-mark.svg',
        ],
      },
    },
    { origin: 'imported', approvalStatus: 'approved' },
  )
}

describe('evidence-bound BrandForge logos', () => {
  it('binds the production-shaped Aurora URL-only logo to pinned evidence', () => {
    const contract = auroraContract()
    const assets = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        fileUrl:
          'https://cdn.example.com/aurora/logo.svg?format=svg&width=800',
        contentHash: 'a'.repeat(64),
      },
    ]

    expect(bindApprovedBrandLogos(contract, assets)).toEqual([
      {
        role: 'primary',
        url: assets[0].fileUrl,
        assetId: assets[0].id,
        contentHash: assets[0].contentHash,
      },
    ])
    expect(brandContextFromContract(contract, assets).logoAssets).toMatchObject({
      primaryUrl: assets[0].fileUrl,
      primaryAssetId: assets[0].id,
      primaryContentHash: assets[0].contentHash,
      variations: [],
      variantAssetIds: [],
    })
  })

  it('fails closed for unknown or content-ambiguous URL-only assets', () => {
    const contract = auroraContract()
    const duplicatedUrl =
      'https://cdn.example.com/aurora/logo.svg?format=svg&width=800'
    const bound = bindApprovedBrandLogos(contract, [
      {
        id: '11111111-1111-4111-8111-111111111111',
        fileUrl: duplicatedUrl,
        contentHash: 'a'.repeat(64),
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        fileUrl: duplicatedUrl,
        contentHash: 'b'.repeat(64),
      },
    ])

    expect(bound).toEqual([])
  })
})
