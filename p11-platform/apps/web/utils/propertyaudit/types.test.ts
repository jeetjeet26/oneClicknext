import { describe, expect, it } from 'vitest'
import {
  classifyProviderFailure,
  DEFAULT_AUDIT_SURFACES,
  getSurfaceLabel,
  isSupportedSurface,
} from './types'

describe('PropertyAudit surface helpers', () => {
  it('defaults to the four sellable v1 surfaces', () => {
    expect(DEFAULT_AUDIT_SURFACES).toEqual(['chatgpt', 'gemini', 'perplexity', 'google_ai'])
  })

  it('validates and labels supported surfaces', () => {
    expect(isSupportedSurface('perplexity')).toBe(true)
    expect(isSupportedSurface('not-real')).toBe(false)
    expect(getSurfaceLabel('google_ai')).toBe('Google AI Proxy')
  })

  it('classifies provider failures for operator reporting', () => {
    expect(classifyProviderFailure('PERPLEXITY_API_KEY not set')).toBe('missing_provider_key')
    expect(classifyProviderFailure('SerpAPI search failed')).toBe('search_unavailable')
    expect(classifyProviderFailure('request timeout')).toBe('timeout')
    expect(classifyProviderFailure('failed to parse JSON analysis')).toBe('analysis_failed')
    expect(classifyProviderFailure('provider returned 503')).toBe('provider_unavailable')
  })
})
