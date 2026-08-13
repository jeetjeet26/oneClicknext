import { describe, expect, it } from 'vitest'
import {
  buildSiteForgePhotoTrustUpdate,
  isSiteForgePhotoAsset,
} from './trust-policy'

describe('SiteForge photo trust policy', () => {
  it('creates an auditable trusted provider-import state', () => {
    const update = buildSiteForgePhotoTrustUpdate({
      userId: '11111111-1111-4111-8111-111111111111',
      trustedAt: '2026-08-13T17:00:00.000Z',
      sourceIdentity: 'google_drive:file-1',
      contentHash: 'a'.repeat(64),
      intake: 'provider_import',
      importSource: 'google_drive',
      sourceId: '22222222-2222-4222-8222-222222222222',
      providerFileId: 'file-1',
    })

    expect(update).toEqual(
      expect.objectContaining({
        rights_status: 'owned',
        approval_status: 'approved',
        curation_status: 'approved',
        expires_at: null,
        approved_by: '11111111-1111-4111-8111-111111111111',
        approved_at: '2026-08-13T17:00:00.000Z',
        rights_metadata: expect.objectContaining({
          siteforgeTrustEvents: [
            expect.objectContaining({
              intake: 'provider_import',
              importSource: 'google_drive',
              sourceIdentity: 'google_drive:file-1',
              contentHash: 'a'.repeat(64),
              providerFileId: 'file-1',
            }),
          ],
        }),
      })
    )
  })

  it('preserves deliberate production selection and prior trust events', () => {
    const update = buildSiteForgePhotoTrustUpdate({
      userId: '11111111-1111-4111-8111-111111111111',
      trustedAt: '2026-08-13T18:00:00.000Z',
      sourceIdentity: 'siteforge-upload:hash:pool.jpg',
      contentHash: 'b'.repeat(64),
      intake: 'direct_upload',
      importSource: 'siteforge',
      currentCurationStatus: 'selected',
      currentRightsMetadata: {
        siteforgeTrustEvents: [{ trustedAt: 'earlier' }],
      },
    })

    expect(update.curation_status).toBe('selected')
    expect(
      (update.rights_metadata as { siteforgeTrustEvents: unknown[] })
        .siteforgeTrustEvents
    ).toHaveLength(2)
  })

  it('excludes BrandForge legal asset roles', () => {
    expect(
      isSiteForgePhotoAsset({
        asset_type: 'image',
        asset_role: 'primary_logo',
      })
    ).toBe(false)
    expect(
      isSiteForgePhotoAsset({ asset_type: 'image', asset_role: 'floorplan' })
    ).toBe(true)
  })
})
