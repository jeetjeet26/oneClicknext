import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SiteForgeEditorSnapshot } from './context'
import {
  isAuroraSemanticReplayEnabled,
  runAuroraSemanticReplay,
} from './aurora-replay'

const snapshot = {
  website: {
    id: '11111111-1111-4111-8111-111111111111',
    propertyId: '22222222-2222-4222-8222-222222222222',
    orgId: '33333333-3333-4333-8333-333333333333',
  },
  artifact: {
    id: '44444444-4444-4444-8444-444444444444',
    version: 1,
    contentHash: 'a'.repeat(64),
    blueprint: { version: 1, pages: [] },
    assetManifest: [],
    siteConfiguration: {},
    motionConfiguration: {},
    baseThemePackageId: null,
    baseThemePackageSha256: null,
    overlayPackageSha256: null,
    runtimeContractVersion: 3,
    runtimePackageSha256: 'b'.repeat(64),
  },
  propertyEvidence: {},
  approvedAssets: [],
  revisionHistory: [],
  conversationHistory: [],
  wordpressCapabilities: {},
  renderedEvidence: {
    source: 'certification_not_required',
    artifactId: '44444444-4444-4444-8444-444444444444',
    contentHash: 'a'.repeat(64),
    report: {},
  },
  visualAttachments: [],
} as SiteForgeEditorSnapshot

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Aurora semantic replay', () => {
  it('creates a browser-only extension without calling a model', async () => {
    vi.stubEnv('SITEFORGE_AURORA_SEMANTIC_REPLAY', 'true')
    vi.stubEnv('SITEFORGE_AURORA_LIFECYCLE_CONTROL_ENABLED', 'true')

    expect(isAuroraSemanticReplayEnabled()).toBe(true)
    const replay = await runAuroraSemanticReplay({
      snapshot,
      userIntent:
        'Custom interaction: propose a governed extension for an accessible floor-plan comparison control.',
    })

    expect(replay.model).toBe('siteforge-aurora-replay-v1')
    expect(replay.operations).toEqual([])
    expect(replay.extensionRequest?.overlay.files.map(file => file.path)).toEqual(
      [
        'assets/css/floorplan-compare.css',
        'assets/js/floorplan-compare.js',
      ]
    )
  })
})
