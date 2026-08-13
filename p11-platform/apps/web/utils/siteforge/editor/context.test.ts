import { describe, expect, it } from 'vitest'
import { isCloudwaysThemeInstallationConfigured } from './feature'
import { selectRenderedEditorEvidence } from './context'

describe('SiteForge editor context', () => {
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
    expect(
      isCloudwaysThemeInstallationConfigured({
        accessToken: 'a'.repeat(32),
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
