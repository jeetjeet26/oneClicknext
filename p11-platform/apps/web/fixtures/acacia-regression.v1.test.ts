import { describe, expect, it } from 'vitest'
import { ACACIA_REGRESSION_BASELINE_V1 as acacia } from './acacia-regression.v1'

describe('sanitized Acacia regression baseline v1', () => {
  it('pins public property identity and configured customer links', () => {
    expect(acacia).toMatchObject({
      fixtureVersion: 1,
      sanitized: true,
      property: {
        name: 'Acacia',
        address: '420 Acacia Avenue, Palo Alto, CA 94306',
        phone: '408-763-5306',
        inventoryMessage: 'final homes',
        bedrooms: 3,
        bathrooms: 2.5,
      },
      chatbot: {
        reviewedContext: {
          status: 'current',
          requiresReview: false,
          servingMode: 'full',
        },
        reviewRequiredContext: {
          status: 'needs_review',
          requiresReview: true,
          servingMode: 'degraded',
        },
        configuredLinks: {
          floorPlans:
            'https://www.dividendhomes.com/communities/acacia/floor-plans/',
          availability:
            'https://www.dividendhomes.com/communities/acacia/site-plan/',
        },
      },
    })
  })

  it('pins loader, handoff, telemetry, consent, origin, and v1/v2 compatibility contracts', () => {
    expect(acacia.widget).toMatchObject({
      loaderPath: '/lumaleasing.js',
      defaultOptions: { position: 'bottom-right' },
      requiresEnvironmentSuppliedKey: true,
    })
    expect(acacia.chatbot.handoff).toMatchObject({
      leadPromptAfterMessages: 3,
      tourIsCallToActionOnly: true,
    })
    expect(acacia.siteForge).toMatchObject({
      allowedOrigins: ['https://www.dividendhomes.com'],
      conversionConsent: {
        evidenceRequired: true,
      },
      telemetry: {
        confirmedEvents: ['lead_submit', 'tour_booked'],
        respectsAnalyticsConsent: true,
      },
      compatibility: {
        artifactSchemaVersion: 1,
        runtimeContractVersion: 2,
      },
      existingArtifactFeatureDefaults: {
        publicRuntime: false,
        analytics: false,
        chatbot: false,
        tours: false,
      },
    })
  })
})
