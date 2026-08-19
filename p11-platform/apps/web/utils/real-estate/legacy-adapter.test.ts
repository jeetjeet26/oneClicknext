import { describe, expect, it } from 'vitest'
import {
  legacyPropertyTypeToVerticalProfile,
  normalizeLegacyPropertyVerticalProfile,
} from './legacy-adapter'

describe('legacy property type vertical adapter', () => {
  it('maps unambiguous intake types to confirmed vertical profiles', () => {
    expect(legacyPropertyTypeToVerticalProfile('multifamily')).toMatchObject({
      profile: {
        subjectKind: 'real_estate_property',
        verticalKey: 'multifamily_residential',
        source: 'legacy_property_type',
        legacyPropertyType: 'multifamily',
      },
      mappingStatus: 'confirmed',
      verticalPack: {
        key: 'siteforge.real_estate.multifamily_residential',
        version: 1,
      },
    })
  })

  it.each([
    ['mixed_use', 'Legacy mixed_use'],
    ['luxury', 'Legacy luxury'],
    [null, 'Legacy property type is missing'],
  ] as const)(
    'keeps ambiguous legacy mapping %s in needs_review',
    (propertyType, reason) => {
      const mapped = legacyPropertyTypeToVerticalProfile(propertyType)

      expect(mapped.mappingStatus).toBe('needs_review')
      expect(mapped.mappingReason).toContain(reason)
    }
  )

  it('preserves a non-property subject kind supplied by compatible intake', () => {
    expect(
      legacyPropertyTypeToVerticalProfile(
        'master_planned',
        'real_estate_development'
      ).profile.subjectKind
    ).toBe('real_estate_development')
  })

  it('normalizes incomplete persisted legacy profiles for new guided builds', () => {
    expect(
      normalizeLegacyPropertyVerticalProfile({
        schemaVersion: 2,
        subjectKind: 'real_estate_property',
        verticalKey: 'multifamily_residential',
        source: 'legacy_property_type',
        legacyPropertyType: 'multifamily',
        mappingStatus: 'confirmed',
      })
    ).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        verticalKey: 'multifamily_residential',
        displayName: 'Multifamily residential',
        operatingModel: 'rental_residential',
        attributes: {},
        audiences: [],
        complianceTags: [],
      })
    )
  })
})
