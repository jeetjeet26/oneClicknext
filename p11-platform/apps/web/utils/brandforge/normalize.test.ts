import { describe, expect, it } from 'vitest'
import {
  brandContractToStorageSections,
  hashBrandForgeContract,
  normalizeBrandAssetRow,
  normalizeBrandForgeContract,
} from './normalize'

describe('BrandForgeContractV1 normalization', () => {
  it('normalizes generated legacy aliases into canonical roles', () => {
    const contract = normalizeBrandAssetRow({
      brand_origin: 'generated',
      generation_status: 'complete',
      section_5_name_story: { name: 'The Aurora', tagline: 'Live brighter' },
      section_6_logo: { primary_url: 'https://example.com/logo.svg' },
      section_7_typography: {
        primaryFont: { name: 'Cormorant', weight: '700', usage: 'Headlines' },
        secondaryFont: { name: 'Inter', weight: 400, usage: 'Body copy' },
      },
      section_8_colors: {
        primary: { name: 'Midnight', hex: '112233' },
        secondary: [{ name: 'Cloud', hex: '#F2F2F2' }],
      },
    })

    expect(contract.contractVersion).toBe('1.0')
    expect(contract.logos.variants[0]).toEqual(expect.objectContaining({
      role: 'primary',
      url: 'https://example.com/logo.svg',
    }))
    expect(contract.typography.roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'headline', family: 'Cormorant', weights: [700] }),
      expect.objectContaining({ role: 'body', family: 'Inter', weights: [400] }),
    ]))
    expect(contract.colors.roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'primary', hex: '#112233' }),
      expect.objectContaining({ role: 'secondary', hex: '#F2F2F2' }),
    ]))
    expect(contract.introduction._meta.approval.status).toBe('approved')
  })

  it('preserves imported provenance and produces a stable hash', () => {
    const input = {
      identity: { name: 'Existing Brand' },
      logos: {
        variants: [{
          role: 'primary',
          url: 'https://example.com/logo.png',
          alt: 'Existing Brand',
          restrictions: ['Do not stretch'],
        }],
      },
      colors: {
        roles: [{
          role: 'primary',
          name: 'Blue',
          hex: '#123456',
          usage: 'Primary actions',
        }],
      },
    }
    const first = normalizeBrandForgeContract(input, {
      origin: 'imported',
      approvalStatus: 'reviewing',
      confidence: 0.8,
    })
    const second = normalizeBrandForgeContract(input, {
      origin: 'imported',
      approvalStatus: 'reviewing',
      confidence: 0.8,
    })

    expect(first.origin).toBe('imported')
    expect(hashBrandForgeContract(first)).toBe(hashBrandForgeContract(second))
    expect(brandContractToStorageSections(first).section_6_logo).toEqual(first.logos)
  })

  it('upgrades legacy palette arrays into complete semantic website roles', () => {
    const contract = normalizeBrandAssetRow({
      brand_origin: 'generated',
      approval_status: 'approved',
      section_5_name_story: { name: 'The Aurora' },
      section_8_colors: {
        primary: [
          {
            name: 'Aurora Gold',
            hex: '#C9A962',
            usage: 'Accents, logo, CTAs',
          },
          {
            name: 'Mountain Sage',
            hex: '#7D8B74',
            usage: 'Primary brand color',
          },
        ],
        secondary: [
          {
            name: 'Alpine Cream',
            hex: '#F5F1E8',
            usage: 'Backgrounds',
          },
          {
            name: 'Twilight Navy',
            hex: '#2C3E50',
            usage: 'Text, contrast',
          },
        ],
      },
    })

    expect(contract.colors.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'primary',
          name: 'Mountain Sage',
          hex: '#7D8B74',
        }),
        expect.objectContaining({
          role: 'accent',
          name: 'Aurora Gold',
          hex: '#C9A962',
        }),
        expect.objectContaining({
          role: 'background',
          name: 'Alpine Cream',
          hex: '#F5F1E8',
        }),
        expect.objectContaining({
          role: 'text',
          name: 'Twilight Navy',
          hex: '#2C3E50',
        }),
        expect.objectContaining({
          role: 'secondary',
          name: 'Twilight Navy',
          hex: '#2C3E50',
        }),
      ])
    )
  })
})
