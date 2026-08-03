import { describe, expect, it } from 'vitest'
import {
  isCloudwaysThemeInstallationConfigured,
  isTrustedCertificationRequired,
  shouldBlockUncertifiedPreview,
} from './feature'

describe('isTrustedCertificationRequired', () => {
  it('keeps trusted certification opt-in', () => {
    expect(isTrustedCertificationRequired(undefined)).toBe(false)
    expect(isTrustedCertificationRequired('false')).toBe(false)
    expect(isTrustedCertificationRequired('TRUE')).toBe(true)
  })

  it('blocks failed preview certification only when enforcement is enabled', () => {
    expect(shouldBlockUncertifiedPreview(false, 'false')).toBe(false)
    expect(shouldBlockUncertifiedPreview(false, 'true')).toBe(true)
    expect(shouldBlockUncertifiedPreview(true, 'true')).toBe(false)
  })

  it('rejects placeholder Cloudways configuration for overlay installation', () => {
    expect(
      isCloudwaysThemeInstallationConfigured({
        apiKey: 'placeholder',
        email: 'placeholder',
        acfLicenseKey: 'placeholder',
      })
    ).toBe(false)
    expect(
      isCloudwaysThemeInstallationConfigured({
        apiKey: 'a'.repeat(32),
        email: 'operator@example.com',
        acfLicenseKey: 'b'.repeat(24),
      })
    ).toBe(true)
  })
})
