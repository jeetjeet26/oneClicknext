import { describe, expect, it } from 'vitest'
import {
  isSiteForgeRuntimeExtensionsEnabled,
  isSiteForgeSemanticEditorEnabled,
} from './feature'

describe('SiteForge semantic editor feature flag', () => {
  it('defaults open and supports an explicit emergency opt-out', () => {
    expect(isSiteForgeSemanticEditorEnabled(undefined)).toBe(true)
    expect(isSiteForgeSemanticEditorEnabled('true')).toBe(true)
    expect(isSiteForgeSemanticEditorEnabled(' false ')).toBe(false)
  })
})

describe('SiteForge runtime extension feature flag', () => {
  it('defaults closed and requires an explicit true value', () => {
    expect(isSiteForgeRuntimeExtensionsEnabled(undefined)).toBe(false)
    expect(isSiteForgeRuntimeExtensionsEnabled('false')).toBe(false)
    expect(isSiteForgeRuntimeExtensionsEnabled(' true ')).toBe(true)
  })
})
