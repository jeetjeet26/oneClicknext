import { describe, expect, it } from 'vitest'
import {
  evaluateCapabilityReadiness,
  evaluateRequiredAssetReadiness,
  includeAdditionalUrlsInOnboardingPayload,
  normalizeOnboardingAdditionalUrls,
} from './repository'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

function asset(
  id: string,
  role: string,
  overrides: Partial<Parameters<typeof evaluateRequiredAssetReadiness>[0][number]> = {},
) {
  return {
    id,
    asset_role: role,
    asset_type: 'image',
    approval_status: 'approved',
    curation_status: 'approved',
    rights_status: 'owned',
    expires_at: null,
    duplicate_of: null,
    ...overrides,
  }
}

describe('onboarding asset readiness', () => {
  it('requires a rights-cleared primary logo but keeps photography optional', () => {
    const result = evaluateRequiredAssetReadiness([
      asset('photo-1', 'hero'),
      asset('photo-2', 'interior'),
    ])

    expect(result.ready).toBe(false)
    expect(result.reasons).toEqual([
      'An approved, curated, rights-cleared primary logo is required',
    ])
  })

  it('allows generation with a logo and no property photography', () => {
    const result = evaluateRequiredAssetReadiness([
      asset('logo', 'primary_logo'),
    ])

    expect(result.ready).toBe(true)
    expect(result.propertyPhotography).toEqual([])
  })

  it('counts only approved, unexpired, rights-cleared optional photography', () => {
    const result = evaluateRequiredAssetReadiness(
      [
        asset('logo', 'primary_logo'),
        asset('photo-1', 'hero'),
        asset('photo-2', 'interior', { approval_status: 'pending' }),
        asset('photo-3', 'exterior', { rights_status: 'unknown' }),
        asset('photo-4', 'gallery', { expires_at: '2026-08-01T00:00:00.000Z' }),
        asset('photo-5', 'lifestyle'),
        asset('photo-6', 'amenity'),
      ],
      new Date('2026-08-12T00:00:00.000Z'),
    )

    expect(result.ready).toBe(true)
    expect(result.propertyPhotography.map(photo => photo.id)).toEqual([
      'photo-1',
      'photo-5',
      'photo-6',
    ])
  })

  it('rejects uncurated and duplicate assets before readiness approval', () => {
    const result = evaluateRequiredAssetReadiness([
      asset('logo', 'primary_logo', { curation_status: 'needs_review' }),
      asset('photo-1', 'hero'),
      asset('photo-2', 'interior'),
      asset('photo-3', 'exterior', { duplicate_of: 'photo-1' }),
      asset('photo-4', 'amenity'),
    ])

    expect(result.ready).toBe(false)
    expect(result.primaryLogo).toBeUndefined()
    expect(result.propertyPhotography.map(photo => photo.id)).toEqual([
      'photo-1',
      'photo-2',
      'photo-4',
    ])
  })
})

describe('onboarding capability readiness', () => {
  it('accepts a validated persisted GA4 destination for analytics readiness', () => {
    expect(
      evaluateCapabilityReadiness({
        enabledCapabilities: ['analytics'],
        integrations: [],
        analyticsDestinations: [
          {
            destination_type: 'ga4',
            destination_identity: 'G-ABCDEF12',
            consent_mode: 'required',
            enabled: true,
          },
        ],
        hasChatbotContext: false,
      }),
    ).toEqual([])
  })

  it('rejects malformed or disabled analytics destinations', () => {
    expect(
      evaluateCapabilityReadiness({
        enabledCapabilities: ['analytics'],
        integrations: [],
        analyticsDestinations: [
          {
            destination_type: 'gtm',
            destination_identity: 'invalid',
            consent_mode: 'required',
            enabled: true,
          },
        ],
        hasChatbotContext: false,
      }),
    ).toEqual(['analytics is enabled but no active provider is configured'])
  })
})

describe('onboarding canonical payload', () => {
  it('changes the canonical hash when additional source URLs change', () => {
    const first = includeAdditionalUrlsInOnboardingPayload(
      { property: { id: 'property-1' } },
      ['https://first.example.com']
    )
    const second = includeAdditionalUrlsInOnboardingPayload(
      { property: { id: 'property-1' } },
      ['https://second.example.com']
    )

    expect(hashSiteForgeContent(first)).not.toBe(hashSiteForgeContent(second))
  })

  it('normalizes, deduplicates, and sorts additional URLs before hashing', () => {
    const variants = [
      ' HTTPS://Example.COM:443/floor-plans/#availability ',
      'https://example.com/floor-plans',
      'example.com/amenities?b=2&a=1',
      'not a valid url',
    ]

    expect(normalizeOnboardingAdditionalUrls(variants)).toEqual([
      'https://example.com/amenities?a=1&b=2',
      'https://example.com/floor-plans',
    ])
    const normalized = includeAdditionalUrlsInOnboardingPayload(
      { property: { id: 'property-1' } },
      variants,
    )
    const reordered = includeAdditionalUrlsInOnboardingPayload(
      { property: { id: 'property-1' } },
      [
        'https://example.com/amenities?a=1&b=2',
        'https://example.com/floor-plans/',
      ],
    )
    expect(hashSiteForgeContent(normalized)).toBe(hashSiteForgeContent(reordered))
  })
})
