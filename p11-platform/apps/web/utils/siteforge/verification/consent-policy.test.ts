import { describe, expect, it } from 'vitest'
import { evaluateConsentPolicy } from './consent-policy'

describe('SiteForge consent policy', () => {
  it('allows essential scripts while blocking analytics until opt-in', () => {
    const decision = evaluateConsentPolicy({
      defaultState: 'denied',
      bannerVisible: true,
      preferenceControlsUsable: true,
      scripts: [
        {
          src: '/runtime.js',
          category: 'essential',
          loadedBeforeConsent: true,
          loadedAfterConsent: true,
        },
        {
          src: 'https://analytics.example.com/tag.js',
          category: 'analytics',
          loadedBeforeConsent: false,
          loadedAfterConsent: true,
        },
      ],
    })

    expect(decision.passed).toBe(true)
  })

  it('fails when an unknown or marketing script loads before consent', () => {
    const decision = evaluateConsentPolicy({
      defaultState: 'denied',
      bannerVisible: true,
      preferenceControlsUsable: true,
      scripts: [{
        src: 'https://tracker.example.com/tag.js',
        category: 'unknown',
        loadedBeforeConsent: true,
        loadedAfterConsent: true,
      }],
    })

    expect(decision.passed).toBe(false)
    expect(decision.prematurelyLoaded).toHaveLength(1)
  })
})
