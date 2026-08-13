import { describe, expect, it } from 'vitest'
import {
  buildSiteForgeDirectorCommands,
  type SiteForgeDirectorCommandContext,
} from './command-registry'

function context(
  release: Partial<SiteForgeDirectorCommandContext['release']>
): SiteForgeDirectorCommandContext {
  return {
    websiteId: 'website-1',
    propertyId: 'property-1',
    plan: {
      id: null,
      status: null,
      revision: null,
      contentHash: null,
    },
    artifact: {
      id: 'artifact-1',
      contentHash: 'a'.repeat(64),
      deploymentDecision: 'approved',
      previewExact: true,
      stagingTargetId: 'staging-target-1',
      stagingExact: true,
    },
    release: {
      id: 'release-1',
      state: 'live',
      artifactId: 'artifact-1',
      contentHash: 'a'.repeat(64),
      rollbackArtifactId: null,
      rollbackContentHash: null,
      ...release,
    },
    production: {
      artifactId: 'artifact-1',
      contentHash: 'a'.repeat(64),
      certifiedAt: '2026-08-10T00:00:00.000Z',
    },
    jobs: [],
    incidents: [],
  }
}

describe('SiteForge Director recovery commands', () => {
  it('offers supervised restore for backup-only first-launch recovery', () => {
    const restore = buildSiteForgeDirectorCommands(context({})).find(
      command => command.type === 'restore_release'
    )

    expect(restore).toMatchObject({
      available: true,
      unavailableReason: null,
      payload: {
        propertyId: 'property-1',
        releaseId: 'release-1',
      },
    })
    expect(restore?.description).toContain('pre-promotion backup')
  })

  it('does not offer restore before a release reaches a recoverable state', () => {
    const restore = buildSiteForgeDirectorCommands(
      context({ state: 'launch_approved' })
    ).find(command => command.type === 'restore_release')

    expect(restore?.available).toBe(false)
  })
})
