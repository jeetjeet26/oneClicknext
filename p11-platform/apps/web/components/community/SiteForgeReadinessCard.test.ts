import { describe, expect, it } from 'vitest'
import {
  readinessRemediationUrl,
  SITEFORGE_CAPABILITIES,
} from './SiteForgeReadinessCard'

describe('SiteForge readiness UI contract', () => {
  it('exposes every capability that can be frozen into readiness', () => {
    expect(SITEFORGE_CAPABILITIES.map(capability => capability.value)).toEqual([
      'crm',
      'tours',
      'chatbot',
      'analytics',
    ])
  })

  it('maps server domain names to actionable remediation', () => {
    expect(readinessRemediationUrl('identityContact', 'property-1')).toBe(
      '/dashboard/properties',
    )
    expect(readinessRemediationUrl('propertyFacts', 'property-1')).toBe(
      '/dashboard/community',
    )
    expect(readinessRemediationUrl('brand', 'property-1')).toBe(
      '/dashboard/brandforge/property-1',
    )
  })
})
