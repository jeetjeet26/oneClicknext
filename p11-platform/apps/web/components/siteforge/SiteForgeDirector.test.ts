import { describe, expect, it } from 'vitest'
import {
  normalizeSiteForgeDirectorArea,
  SITEFORGE_DIRECTOR_AREAS,
} from './SiteForgeDirector'
import { canRunSiteForgeCritique } from './SiteForgeCritiqueWorkspace'
import {
  SITEFORGE_DELIVERY_TABS,
  SITEFORGE_PLAN_TABS,
  SITEFORGE_REVIEW_TABS,
} from './SiteForgeWebDirectorWorkspaces'

describe('SiteForge Web Director composition', () => {
  it('exposes every operator surface through progressive workspaces', () => {
    expect(SITEFORGE_DIRECTOR_AREAS.map(area => area.label)).toEqual([
      'Overview',
      'Plan',
      'Build & review',
      'Delivery',
      'Ownership & reporting',
      'Jobs & decisions',
      'Control & recovery',
    ])
    expect(SITEFORGE_PLAN_TABS.map(tab => tab.label)).toEqual([
      'Plan approval',
      'Brief',
      'Creative directions',
      'Asset room',
    ])
    expect(SITEFORGE_REVIEW_TABS.map(tab => tab.label)).toEqual([
      'Editor & preview',
      'Critique & proposals',
      'Client review',
    ])
    expect(SITEFORGE_DELIVERY_TABS.map(tab => tab.label)).toEqual([
      'Migration',
      'Connectors',
      'Launch & recovery',
    ])
  })

  it('opens the authoritative planning area from operator journey links', () => {
    expect(normalizeSiteForgeDirectorArea('plan')).toBe('plan')
    expect(normalizeSiteForgeDirectorArea('unknown')).toBe('overview')
  })

  it('requires exact passed certification before critique can run', () => {
    const artifact = {
      artifactId: '9ee8c196-5417-45f7-ad91-4760af06f575',
      contentHash: 'a'.repeat(64),
      version: 7,
    }
    expect(
      canRunSiteForgeCritique(artifact, {
        id: 'a56412be-2bd1-4ff5-bcba-5132295f64b4',
        status: 'passed',
        exact: true,
      })
    ).toBe(true)
    expect(
      canRunSiteForgeCritique(artifact, {
        id: 'a56412be-2bd1-4ff5-bcba-5132295f64b4',
        status: 'passed',
        exact: false,
      })
    ).toBe(false)
  })
})
