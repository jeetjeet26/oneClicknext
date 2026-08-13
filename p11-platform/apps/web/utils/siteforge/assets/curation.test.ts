import { describe, expect, it } from 'vitest'
import {
  buildCoverageMatrix,
  buildValidatedAssetUpdate,
  getAssetUsability,
} from './curation'

const usableAsset = {
  approval_status: 'approved',
  curation_status: 'selected',
  rights_status: 'owned',
  expires_at: null,
  duplicate_of: null,
}

describe('SiteForge asset curation', () => {
  it('only allows rights-cleared approved/selected assets into production', () => {
    expect(getAssetUsability(usableAsset)).toEqual({
      usable: true,
      blockers: [],
    })
    expect(
      getAssetUsability({ ...usableAsset, rights_status: 'unknown' })
    ).toMatchObject({ usable: false, blockers: ['rights_not_cleared'] })
    expect(
      getAssetUsability({ ...usableAsset, curation_status: 'generated' })
    ).toMatchObject({ usable: false, blockers: ['curation_required'] })
    expect(
      getAssetUsability({
        ...usableAsset,
        expires_at: '2020-01-01T00:00:00.000Z',
      })
    ).toMatchObject({ usable: false, blockers: ['rights_expired'] })
    expect(
      getAssetUsability({ ...usableAsset, duplicate_of: crypto.randomUUID() })
    ).toMatchObject({ usable: false, blockers: ['duplicate'] })
  })

  it('rejects approvals without cleared and current rights', () => {
    expect(() =>
      buildValidatedAssetUpdate({
        current: {
          approval_status: 'pending',
          curation_status: 'needs_review',
          rights_status: 'unknown',
          rights_metadata: {},
          expires_at: null,
          duplicate_of: null,
        },
        patch: {
          approvalStatus: 'approved',
          curationStatus: 'approved',
        },
        userId: crypto.randomUUID(),
      })
    ).toThrow('Rights must be cleared')

    expect(() =>
      buildValidatedAssetUpdate({
        current: {
          approval_status: 'pending',
          curation_status: 'needs_review',
          rights_status: 'licensed',
          rights_metadata: {},
          expires_at: null,
          duplicate_of: null,
        },
        patch: {
          approvalStatus: 'approved',
          curationStatus: 'selected',
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
        userId: crypto.randomUUID(),
      })
    ).toThrow('Expired rights')
  })

  it('builds a missing-shot checklist from usable assets only', () => {
    const coverage = buildCoverageMatrix([
      { ...usableAsset, asset_role: 'hero' },
      {
        ...usableAsset,
        asset_role: 'amenity',
        approval_status: 'pending',
      },
    ])
    expect(coverage.matrix.find((entry) => entry.role === 'hero')).toMatchObject({
      usable: 1,
      covered: true,
    })
    expect(
      coverage.missingShots.find((entry) => entry.role === 'amenity')
    ).toMatchObject({ missing: 3 })
    expect(coverage.ready).toBe(false)
  })
})
