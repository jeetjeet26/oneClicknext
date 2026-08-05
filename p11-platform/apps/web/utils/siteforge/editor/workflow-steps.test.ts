import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { immutableSnapshotChanged } from './immutable-snapshot'

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
})
