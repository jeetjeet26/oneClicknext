import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { immutableSnapshotChanged } from './immutable-snapshot'
import { buildSemanticEditCorrectionIntent } from './workflow-steps'

describe('immutableSnapshotChanged', () => {
  it('accepts legacy artifacts where optional snapshots are absent', () => {
    expect(immutableSnapshotChanged({}, {}, 'brandSnapshot')).toBe(false)
    expect(immutableSnapshotChanged({}, {}, 'onboardingSnapshot')).toBe(false)
  })

  it('detects additions and content changes', () => {
    expect(
      immutableSnapshotChanged({ brandSnapshot: {} }, {}, 'brandSnapshot')
    ).toBe(true)
    expect(
      immutableSnapshotChanged(
        { brandSnapshot: { name: 'Aurora' } },
        { brandSnapshot: { name: 'Other' } },
        'brandSnapshot'
      )
    ).toBe(true)
  })
})

describe('semantic edit release identity', () => {
  it('inherits the immutable parent theme package instead of adopting local files', async () => {
    const source = await readFile(
      new URL('./workflow-steps.ts', import.meta.url),
      'utf8'
    )

    expect(source).toContain('snapshot.artifact.baseThemePackageId')
    expect(source).toContain('snapshot.artifact.baseThemePackageSha256')
    expect(source).not.toContain('runtime-assets/oneclick-siteforge.zip')
  })

  it('validates an immutable overlay before persisting its exact source request', async () => {
    const source = await readFile(
      new URL('./workflow-steps.ts', import.meta.url),
      'utf8'
    )
    const validationIndex = source.indexOf(
      'const overlay = await validateAndStoreThemeOverlay'
    )
    const requestInsertIndex = source.indexOf(
      ".from('siteforge_runtime_extension_requests')"
    )

    expect(validationIndex).toBeGreaterThan(-1)
    expect(requestInsertIndex).toBeGreaterThan(validationIndex)
    expect(source).toContain('artifact_id: snapshot.artifact.id')
    expect(source).toContain('immutable_package_sha256: overlay.packageSha256')
    expect(source).toContain(
      'runtime_compatibility: JSON.stringify(runtimeCompatibility)'
    )
    expect(source).toContain('sourceContentHash: snapshot.artifact.contentHash')
  })

  it('applies validated extensions automatically inside the workflow with no approval ceremony', async () => {
    const source = await readFile(
      new URL('./workflow-steps.ts', import.meta.url),
      'utf8'
    )
    const requestInsertIndex = source.indexOf(
      ".from('siteforge_runtime_extension_requests')"
    )
    const autoApplyIndex = source.indexOf(
      'await approveAndPublishRuntimeExtension'
    )

    // Solo-operator doctrine: the machine policy publishes the validated
    // overlay revision inline. Nothing may reintroduce a state where an
    // extension waits for a UI or a human decision.
    expect(autoApplyIndex).toBeGreaterThan(requestInsertIndex)
    expect(source).not.toContain('awaitingExtensionApproval: true')
    expect(source).toContain(
      "decisionReason: 'siteforge.policy:validated_bounded_extension:v1'"
    )
  })
})

describe('rendered self-verification', () => {
  it('builds a bounded correction intent scoped to the exact rendered mismatches', () => {
    const intent = buildSemanticEditCorrectionIntent(
      'Left-align the hero text container',
      {
        status: 'failed',
        reason: 'mismatch',
        previewUrl: 'https://preview.example.com',
        correctionPasses: 0,
        failures: [
          {
            code: 'computed_style_mismatch',
            pageSlug: 'home',
            selector: '[data-siteforge-section="home-hero"]',
            viewport: 'desktop',
            expected: 'max-width: 1200px',
            actual: 'none',
            repairHint:
              'Repair the compiled style token or selector and recapture computed styles.',
          },
        ],
      }
    )
    expect(intent).toContain('Left-align the hero text container')
    expect(intent).toContain('computed_style_mismatch')
    expect(intent).toContain('max-width: 1200px')
    expect(intent).toContain('Do not touch anything else')
  })

  it('verifies the render after publication with at most two correction passes', async () => {
    const workflow = await readFile(
      new URL('../../../workflows/siteforge-semantic-edit.ts', import.meta.url),
      'utf8'
    )
    expect(workflow).toContain('verifyRenderedSemanticEdit')
    expect(workflow).toContain('correctionPasses < 2')
    expect(workflow).toContain('buildSemanticEditCorrectionIntent')
    // Verification is honest but never destructive: the published revision
    // stays published even when the rendered outcome cannot be corrected.
    expect(workflow).toContain('completeSemanticEdit(input, finalProposal, output, verification)')
  })
})
