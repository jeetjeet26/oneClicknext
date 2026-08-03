import { describe, expect, it } from 'vitest'
import {
  buildGenerationRequest,
  classifyWebsiteStatus,
  isExactArtifactPreview,
  partitionUploadResults,
  preferencesMatch,
  regenerationPlanUrl,
  responseErrorMessage,
  siteForgeStatusEndpoint,
} from './orchestration'

describe('SiteForge frontend orchestration', () => {
  it('labels a WordPress preview exact only when ID and hash both match', () => {
    const exact = {
      currentArtifactId: 'artifact-b',
      currentContentHash: 'b'.repeat(64),
      previewArtifactId: 'artifact-b',
      previewContentHash: 'b'.repeat(64),
    }
    expect(isExactArtifactPreview(exact)).toBe(true)
    expect(
      isExactArtifactPreview({
        ...exact,
        previewContentHash: 'a'.repeat(64),
      })
    ).toBe(false)
    expect(
      isExactArtifactPreview({
        ...exact,
        previewArtifactId: 'artifact-a',
      })
    ).toBe(false)
  })

  it('builds only the canonical immutable generation request', () => {
    expect(
      buildGenerationRequest(
        {
          planId: 'plan-1',
          revision: 4,
          contentHash: 'a'.repeat(64),
        },
        'request-1'
      )
    ).toEqual({
      planId: 'plan-1',
      confirmedRevision: 4,
      contentHash: 'a'.repeat(64),
      idempotencyKey: 'request-1',
    })
  })

  it('routes regeneration back through planning with source context', () => {
    expect(regenerationPlanUrl('property 1', 'website/1')).toBe(
      '/dashboard/siteforge?regeneratePropertyId=property+1&sourceWebsiteId=website%2F1'
    )
  })

  it('uses the website status endpoint for generation and deployment jobs', () => {
    expect(siteForgeStatusEndpoint('website/1')).toBe(
      '/api/siteforge/status/website%2F1'
    )
  })

  it('distinguishes preview readiness from deployment completion', () => {
    const ready = {
      status: 'ready_for_preview' as const,
      currentStep: 'Ready',
    }
    expect(classifyWebsiteStatus(ready, 'generation')).toEqual({
      terminal: true,
      succeeded: true,
    })
    expect(classifyWebsiteStatus(ready, 'deployment')).toEqual({
      terminal: false,
    })
  })

  it('terminalizes deployment failures with diagnostics', () => {
    expect(
      classifyWebsiteStatus(
        {
          status: 'deploy_failed',
          errorMessage: 'fallback',
          deploymentDiagnostics: {
            workflow: 'siteforge_wordpress_deploy',
            status: 'failed',
            provider: 'cloudways',
            startedAt: '2026-01-01T00:00:00.000Z',
            completedAt: '2026-01-01T00:01:00.000Z',
            pagesAttempted: 1,
            assetsAttempted: 0,
            verification: { enabled: true, status: 'failed' },
            deploySource: {
              field: 'blueprint',
              blueprintVersion: 1,
              blueprintUpdatedAt: null,
            },
            error: {
              message: 'WordPress verification failed',
              category: 'verification',
            },
          },
        },
        'deployment'
      )
    ).toEqual({
      terminal: true,
      succeeded: false,
      message: 'WordPress verification failed',
    })
  })

  it('returns actionable authentication and server polling errors', () => {
    expect(responseErrorMessage(401, {}, 'checking generation progress')).toContain(
      'session expired'
    )
    expect(
      responseErrorMessage(503, { error: 'Database unavailable' }, 'loading preview')
    ).toContain('check server logs')
  })

  it('requires displayed preferences to match the persisted plan', () => {
    expect(
      preferencesMatch(
        { style: 'modern', emphasis: 'amenities', ctaPriority: 'tours' },
        { style: 'modern', emphasis: 'amenities', ctaPriority: 'tours' }
      )
    ).toBe(true)
    expect(
      preferencesMatch(
        { style: 'luxury', emphasis: 'amenities', ctaPriority: 'tours' },
        { style: 'modern', emphasis: 'amenities', ctaPriority: 'tours' }
      )
    ).toBe(false)
  })

  it('keeps successful uploads when another selected file fails', () => {
    const uploaded = { id: 'asset-1' }
    expect(
      partitionUploadResults(
        [{ name: 'hero.jpg' }, { name: 'broken.png' }],
        [
          { status: 'fulfilled', value: uploaded },
          { status: 'rejected', reason: new Error('too large') },
        ]
      )
    ).toEqual({
      succeeded: [uploaded],
      failedNames: ['broken.png'],
    })
  })
})
