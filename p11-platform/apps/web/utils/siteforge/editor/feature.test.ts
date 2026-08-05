import { describe, expect, it } from 'vitest'
import { isSiteForgeRuntimeExtensionsEnabled } from './feature'

describe('SiteForge runtime extension feature flag', () => {
  it('defaults closed and requires an explicit true value', () => {
    expect(isSiteForgeRuntimeExtensionsEnabled(undefined)).toBe(false)
    expect(isSiteForgeRuntimeExtensionsEnabled('false')).toBe(false)
    expect(isSiteForgeRuntimeExtensionsEnabled(' true ')).toBe(true)
  })
})
