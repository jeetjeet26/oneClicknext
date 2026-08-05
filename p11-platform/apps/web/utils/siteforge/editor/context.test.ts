import { describe, expect, it } from 'vitest'
import {
  isCloudwaysThemeInstallationConfigured,
  isTrustedCertificationRequired,
  shouldBlockUncertifiedPreview,
} from './feature'
import { selectRenderedEditorEvidence } from './context'

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

describe('selectRenderedEditorEvidence', () => {
  const certification = (artifactId: string, id: string) => ({
    id,
    artifact_id: artifactId,
    policy_version: 'siteforge-certification-v3',
    environment: 'preview',
    status: 'passed',
    report_hash: 'a'.repeat(64),
    report: { passed: true },
  })

  it('uses exact current-artifact evidence when available', () => {
    const evidence = selectRenderedEditorEvidence({
      certifications: [
        certification('current-artifact', 'current-certification'),
        certification('parent-artifact', 'parent-certification'),
      ],
      revisionIds: ['current-artifact', 'parent-artifact'],
      currentArtifactId: 'current-artifact',
      currentContentHash: 'b'.repeat(64),
      certificationRequired: true,
    })

    expect(evidence).toEqual(
      expect.objectContaining({
        source: 'server_certification',
        certificationId: 'current-certification',
        artifactId: 'current-artifact',
      })
    )
  })

  it('allows consecutive edits using clearly marked ancestor evidence', () => {
    const evidence = selectRenderedEditorEvidence({
      certifications: [
        certification('parent-artifact', 'parent-certification'),
      ],
      revisionIds: ['current-artifact', 'parent-artifact'],
      currentArtifactId: 'current-artifact',
      currentContentHash: 'b'.repeat(64),
      certificationRequired: true,
    })

    expect(evidence).toEqual(
      expect.objectContaining({
        source: 'ancestor_certification',
        certificationId: 'parent-certification',
        artifactId: 'parent-artifact',
      })
    )
  })

  it('does not block drafting when no rendered evidence exists', () => {
    const evidence = selectRenderedEditorEvidence({
      certifications: [],
      revisionIds: ['current-artifact'],
      currentArtifactId: 'current-artifact',
      currentContentHash: 'b'.repeat(64),
      certificationRequired: true,
    })

    expect(evidence).toEqual(
      expect.objectContaining({
        source: 'certification_unavailable',
        artifactId: 'current-artifact',
      })
    )
  })
})
