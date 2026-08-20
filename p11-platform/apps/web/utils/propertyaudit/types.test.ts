import { describe, expect, it } from 'vitest'
import {
  classifyProviderFailure,
  DEFAULT_AUDIT_SURFACES,
  getGeoConfig,
  getSurfaceLabel,
  getSurfaceModelName,
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

  it('defaults ChatGPT and Gemini to current consumer-generation proxies', () => {
    const previous = {
      GEO_CHATGPT_MODEL: process.env.GEO_CHATGPT_MODEL,
      GEO_OPENAI_MODEL: process.env.GEO_OPENAI_MODEL,
      GEO_GEMINI_MODEL: process.env.GEO_GEMINI_MODEL,
      GEO_PERPLEXITY_MODEL: process.env.GEO_PERPLEXITY_MODEL,
    }
    delete process.env.GEO_CHATGPT_MODEL
    delete process.env.GEO_OPENAI_MODEL
    delete process.env.GEO_GEMINI_MODEL
    delete process.env.GEO_PERPLEXITY_MODEL
    try {
      expect(getSurfaceModelName('chatgpt')).toBe('gpt-5.6-sol')
      expect(getSurfaceModelName('gemini')).toBe('gemini-3.1-pro-preview')
      expect(getSurfaceModelName('perplexity')).toBe('sonar-pro')
      expect(getGeoConfig().chatgptModel).toBe('gpt-5.6-sol')
      expect(getGeoConfig().geminiModel).toBe('gemini-3.1-pro-preview')
    } finally {
      Object.entries(previous).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
    }
  })

  it('classifies provider failures for operator reporting', () => {
    expect(classifyProviderFailure('PERPLEXITY_API_KEY not set')).toBe('missing_provider_key')
    expect(classifyProviderFailure('SerpAPI search failed')).toBe('search_unavailable')
    expect(classifyProviderFailure('request timeout')).toBe('timeout')
    expect(classifyProviderFailure('failed to parse JSON analysis')).toBe('analysis_failed')
    expect(classifyProviderFailure('provider returned 503')).toBe('provider_unavailable')
  })
})
