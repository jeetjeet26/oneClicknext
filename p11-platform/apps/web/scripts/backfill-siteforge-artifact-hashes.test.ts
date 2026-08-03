import { describe, expect, it } from 'vitest'
import { classifySiteForgeArtifactRepair } from './backfill-siteforge-artifact-hashes'

describe('legacy SiteForge artifact hash repair', () => {
  it('produces a stable canonical SHA-256 independent of object key order', () => {
    const first = classifySiteForgeArtifactRepair({
      blueprint: { title: 'Home', settings: { color: 'blue', enabled: true } },
      assetManifestHash: 'a'.repeat(64),
      baseThemePackageSha256: 'b'.repeat(64),
    })
    const second = classifySiteForgeArtifactRepair({
      blueprint: { settings: { enabled: true, color: 'blue' }, title: 'Home' },
      assetManifestHash: 'a'.repeat(64),
      baseThemePackageSha256: 'b'.repeat(64),
    })

    expect(first.canonicalHash).toBe(second.canonicalHash)
    expect(first.canonicalHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.classification).toBe('deployable')
  })

  it('quarantines repaired content with an incomplete release identity', () => {
    expect(
      classifySiteForgeArtifactRepair({
        blueprint: { title: 'Legacy' },
        assetManifestHash: null,
        baseThemePackageSha256: 'b'.repeat(64),
      })
    ).toMatchObject({
      classification: 'quarantined',
      reasonCodes: ['incomplete_release_identity'],
    })
  })
})
