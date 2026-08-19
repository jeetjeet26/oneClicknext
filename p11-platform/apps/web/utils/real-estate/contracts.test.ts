import { describe, expect, it } from 'vitest'
import {
  createPropertyVerticalProfileSchema,
  hashPropertyVerticalProfile,
  hashPropertyVerticalProfileVersion,
  hashVerticalPackIdentity,
  verticalIdentityColumns,
} from './contracts'

const profileInput = {
  profile: {
    schemaVersion: 2 as const,
    subjectKind: 'real_estate_property' as const,
    verticalKey: 'multifamily_residential',
    displayName: 'Multifamily residential',
    operatingModel: 'rental_residential',
    attributes: { leaseModel: 'traditional', unitCount: 240 },
    audiences: ['prospective_residents'],
    complianceTags: ['fair_housing'],
    source: 'operator' as const,
  },
  mappingStatus: 'confirmed' as const,
  mappingReason: null,
  verticalPack: {
    key: 'siteforge.real_estate.multifamily_residential',
    version: 2,
  },
  expectedVersion: 1,
}

describe('Vertical Platform V2 contracts', () => {
  it('accepts a strict versioned vertical profile and stable pack identity', () => {
    const parsed = createPropertyVerticalProfileSchema.parse(profileInput)

    expect(hashPropertyVerticalProfile(parsed.profile)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashPropertyVerticalProfileVersion(parsed)).toMatch(
      /^[a-f0-9]{64}$/
    )
    expect(hashVerticalPackIdentity(parsed.verticalPack)).toMatch(
      /^[a-f0-9]{64}$/
    )
  })

  it('requires a reason for ambiguous mappings', () => {
    const parsed = createPropertyVerticalProfileSchema.safeParse({
      ...profileInput,
      mappingStatus: 'needs_review',
      mappingReason: null,
    })

    expect(parsed.success).toBe(false)
  })

  it('changes the profile-version hash when only the pack identity changes', () => {
    expect(hashPropertyVerticalProfileVersion(profileInput)).not.toBe(
      hashPropertyVerticalProfileVersion({
        ...profileInput,
        verticalPack: { ...profileInput.verticalPack, version: 3 },
      })
    )
  })

  it('projects exact profile, pack, offering, availability, and policy columns', () => {
    expect(
      verticalIdentityColumns({
        profile: {
          id: '11111111-1111-4111-8111-111111111111',
          contentHash: 'a'.repeat(64),
        },
        pack: {
          key: 'siteforge.real_estate.multifamily_residential',
          version: 2,
          contentHash: 'b'.repeat(64),
        },
        offering: {
          versionId: '22222222-2222-4222-8222-222222222222',
          contentHash: 'c'.repeat(64),
        },
        availability: {
          snapshotId: '33333333-3333-4333-8333-333333333333',
          contentHash: 'd'.repeat(64),
        },
        policy: {
          versionId: '44444444-4444-4444-8444-444444444444',
          contentHash: 'e'.repeat(64),
        },
      })
    ).toEqual({
      vertical_profile_version_id: '11111111-1111-4111-8111-111111111111',
      vertical_profile_content_hash: 'a'.repeat(64),
      vertical_pack_key: 'siteforge.real_estate.multifamily_residential',
      vertical_pack_version: 2,
      vertical_pack_content_hash: 'b'.repeat(64),
      offering_version_id: '22222222-2222-4222-8222-222222222222',
      offering_content_hash: 'c'.repeat(64),
      availability_snapshot_id: '33333333-3333-4333-8333-333333333333',
      availability_content_hash: 'd'.repeat(64),
      policy_version_id: '44444444-4444-4444-8444-444444444444',
      policy_content_hash: 'e'.repeat(64),
    })
  })
})
