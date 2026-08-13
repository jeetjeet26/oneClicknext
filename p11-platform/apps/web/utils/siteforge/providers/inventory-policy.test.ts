import { describe, expect, it } from 'vitest'
import { isSyntheticInventorySource } from './inventory-policy'

describe('SiteForge inventory source policy', () => {
  it('excludes synthetic inventory from readiness and generation evidence', () => {
    expect(
      isSyntheticInventorySource({
        source: 'manual',
        source_identity: 'siteforge_test_seed',
      })
    ).toBe(true)
    expect(
      isSyntheticInventorySource({
        source: 'manual',
        source_identity: 'siteforge-manual-entry',
      })
    ).toBe(false)
  })
})
