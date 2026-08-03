import type { BrowserCertificationEvidence } from './browser-evidence'

export const SITEFORGE_CONSENT_POLICY_VERSION = 'siteforge-consent-v1' as const

export interface ConsentPolicyDecision {
  policyVersion: typeof SITEFORGE_CONSENT_POLICY_VERSION
  passed: boolean
  prematurelyLoaded: BrowserCertificationEvidence['consent']['scripts']
  failedAfterConsent: BrowserCertificationEvidence['consent']['scripts']
  reasons: string[]
}

export function evaluateConsentPolicy(
  consent: BrowserCertificationEvidence['consent']
): ConsentPolicyDecision {
  const prematurelyLoaded = consent.scripts.filter(
    script => script.category !== 'essential' && script.loadedBeforeConsent
  )
  const failedAfterConsent = consent.scripts.filter(
    script =>
      (script.category === 'analytics' || script.category === 'marketing') &&
      !script.loadedAfterConsent
  )
  const reasons = [
    ...(consent.defaultState !== 'denied'
      ? ['Consent must default to denied.']
      : []),
    ...(!consent.bannerVisible ? ['Consent notice was not visible.'] : []),
    ...(!consent.preferenceControlsUsable
      ? ['Consent preference controls were not usable.']
      : []),
    ...(prematurelyLoaded.length
      ? ['One or more non-essential scripts loaded before consent.']
      : []),
    ...(failedAfterConsent.length
      ? ['One or more opted-in scripts failed to load after consent.']
      : []),
  ]
  return {
    policyVersion: SITEFORGE_CONSENT_POLICY_VERSION,
    passed: reasons.length === 0,
    prematurelyLoaded,
    failedAfterConsent,
    reasons,
  }
}
