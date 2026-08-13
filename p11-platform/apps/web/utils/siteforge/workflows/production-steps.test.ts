import { describe, expect, it, vi } from 'vitest'
import {
  applyOrderedFailClosedProjectionUpdates,
  assertPublicLaunchCertificationChecks,
  buildProductionRecoveryEscalation,
  convergeProductionReleaseAndProjections,
  ProductionProjectionReconciliationError,
  productionFailurePosture,
  restoreProductionProtection,
} from './production-steps'

describe('production certification compensation', () => {
  it('fails closed by reapplying settings in protected staging mode', async () => {
    const applySiteForgeSettings = vi.fn().mockResolvedValue(undefined)
    const settings = {
      themeArtifact: { schemaVersion: 2 },
      legal: {
        equalHousingOpportunity: true,
        fairHousingDisclaimer:
          'This property supports Equal Housing Opportunity requirements.',
        privacyPath: '/privacy',
        termsPath: '/terms',
        accessibilityPath: '/accessibility',
      },
      analytics: {
        consentMode: 'required',
        events: ['page_view'],
      },
      publicRuntime: {
        conversionEndpoint: 'https://example.com/api/conversions',
      },
    }

    await restoreProductionProtection(
      { applySiteForgeSettings } as never,
      settings as never
    )

    expect(applySiteForgeSettings).toHaveBeenCalledWith({
      ...settings,
      targetMode: 'staging',
    })
  })

  it('distinguishes restored noindex from supervised recovery', () => {
    expect(
      productionFailurePosture({
        runtimeV3: false,
        protectionRestored: true,
      })
    ).toBe('protected_noindex')
    expect(
      productionFailurePosture({
        runtimeV3: true,
        protectionRestored: false,
      })
    ).toBe('supervised_recovery')
  })

  it('builds a durable critical escalation when restore cannot be queued', () => {
    expect(
      buildProductionRecoveryEscalation({
        releaseId: 'release-1',
        sharedJobId: 'job-1',
        message: 'Public certification failed',
        restoreError: 'No certified rollback identity exists',
      })
    ).toMatchObject({
      dedupe_key: 'production-certification-recovery:release-1',
      severity: 'critical',
      status: 'open',
      category: 'supervised_recovery',
      evidence: {
        restoreRequestFailed: true,
        executionRequiresOperator: true,
      },
    })
  })

  it('requires exact public domain, form, analytics, and consent evidence', () => {
    const report = {
      passed: true,
      targetUrl: 'https://www.example.com/',
      browser: {
        passed: true,
        evidenceAccepted: true,
        checks: [
          {
            code: 'interaction.forms_widgets_keyboard_focus',
            passed: true,
          },
          { code: 'consent.script_blocking', passed: true },
        ],
      },
    }
    expect(() =>
      assertPublicLaunchCertificationChecks(
        report,
        'https://www.example.com/'
      )
    ).not.toThrow()
    expect(() =>
      assertPublicLaunchCertificationChecks(
        {
          ...report,
          targetUrl: 'https://preview.cloudwaysapps.com/',
        },
        'https://www.example.com/'
      )
    ).toThrow('SSL/domain')
    expect(() =>
      assertPublicLaunchCertificationChecks(
        {
          ...report,
          browser: {
            ...report.browser,
            checks: [report.browser.checks[0]],
          },
        },
        'https://www.example.com/'
      )
    ).toThrow('consent')
  })

  it('compensates every attempted projection after a partial write failure', async () => {
    const events: string[] = []
    await expect(
      applyOrderedFailClosedProjectionUpdates([
        {
          name: 'deployment',
          apply: async () => {
            events.push('deployment:live')
          },
          compensate: async () => {
            events.push('deployment:closed')
          },
        },
        {
          name: 'target',
          apply: async () => {
            events.push('target:partially-live')
            throw new Error('target persistence failed')
          },
          compensate: async () => {
            events.push('target:closed')
          },
        },
        {
          name: 'website',
          apply: async () => {
            events.push('website:live')
          },
          compensate: async () => {
            events.push('website:closed')
          },
        },
      ])
    ).rejects.toThrow('target persistence failed')
    expect(events).toEqual([
      'deployment:live',
      'target:partially-live',
      'target:closed',
      'deployment:closed',
    ])
  })

  it('never projects live when the release transition fails', async () => {
    const events: string[] = []
    await expect(
      convergeProductionReleaseAndProjections({
        checkpointCertification: async () => {
          events.push('release:checkpointed')
          return { state: 'promoted' }
        },
        transitionProductionCertified: async () => {
          events.push('release:transition-failed')
          throw new Error('release transition failed')
        },
        transitionLive: async release => {
          events.push('release:live')
          return release
        },
        reconcileLiveProjections: async () => {
          events.push('projections:live')
        },
      })
    ).rejects.toThrow('release transition failed')
    expect(events).toEqual([
      'release:checkpointed',
      'release:transition-failed',
    ])
  })

  it('orders both release transitions before any live projection', async () => {
    const events: string[] = []
    await expect(
      convergeProductionReleaseAndProjections({
        checkpointCertification: async () => {
          events.push('release:checkpointed')
          return { state: 'promoted' }
        },
        transitionProductionCertified: async () => {
          events.push('release:production_certified')
          return { state: 'production_certified' }
        },
        transitionLive: async () => {
          events.push('release:live')
          return { state: 'live' }
        },
        reconcileLiveProjections: async release => {
          events.push(`projections:${release.state}`)
        },
      })
    ).resolves.toEqual({ state: 'live' })
    expect(events).toEqual([
      'release:checkpointed',
      'release:production_certified',
      'release:live',
      'projections:live',
    ])
  })

  it('keeps live release truth authoritative when projection reconciliation fails and reruns', async () => {
    const events: string[] = []
    let authoritativeLive: { state: string } | null = null
    let projectionAttempts = 0
    const reconcileLiveProjections = async (release: { state: string }) => {
      projectionAttempts += 1
      events.push(`projections:${release.state}:attempt-${projectionAttempts}`)
      if (projectionAttempts === 1) {
        throw new Error('website projection write failed')
      }
    }

    await expect(
      convergeProductionReleaseAndProjections({
        checkpointCertification: async () => ({ state: 'promoted' }),
        transitionProductionCertified: async () => ({
          state: 'production_certified',
        }),
        transitionLive: async () => {
          authoritativeLive = { state: 'live' }
          return authoritativeLive
        },
        reconcileLiveProjections,
      })
    ).rejects.toBeInstanceOf(ProductionProjectionReconciliationError)

    expect(authoritativeLive).toEqual({ state: 'live' })
    await expect(
      reconcileLiveProjections(authoritativeLive!)
    ).resolves.toBeUndefined()
    expect(events).toEqual([
      'projections:live:attempt-1',
      'projections:live:attempt-2',
    ])
  })
})
