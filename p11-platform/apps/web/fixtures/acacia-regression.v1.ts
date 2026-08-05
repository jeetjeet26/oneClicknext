/**
 * Sanitized, local-only regression truth for the public Acacia experience.
 *
 * Keep this fixture free of database identifiers, credentials, private URLs,
 * and captured visitor data. Public-site observations are intentionally
 * separated from the configured chatbot links already covered by route tests.
 */
export const ACACIA_REGRESSION_BASELINE_V1 = {
  fixtureVersion: 1,
  sanitized: true,
  property: {
    name: 'Acacia',
    publicUrl: 'https://www.dividendhomes.com/acacia/',
    address: '420 Acacia Avenue, Palo Alto, CA 94306',
    phone: '408-763-5306',
    inventoryMessage: 'final homes',
    bedrooms: 3,
    bathrooms: 2.5,
  },
  publicSiteLinks: {
    availability: 'https://www.dividendhomes.com/acacia/availability/',
    featuredFloorPlan:
      'https://www.dividendhomes.com/acacia/floor-plans/plan-4/#main-content',
  },
  chatbot: {
    safeFactualQuestion: 'How many bedrooms and bathrooms do the homes have?',
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
    handoff: {
      leadPromptAfterMessages: 3,
      tourIsCallToActionOnly: true,
      leadEndpoint: '/api/lumaleasing/lead',
      tourAvailabilityEndpoint: '/api/lumaleasing/tours/availability',
      tourBookingEndpoint: '/api/lumaleasing/tours',
    },
  },
  widget: {
    loaderPath: '/lumaleasing.js',
    version: '1.0.0',
    apiBasePrecedence: [
      'window.LUMALEASING_API_BASE',
      'loader-script-origin',
      'page-origin',
    ],
    defaultOptions: {
      position: 'bottom-right',
    },
    initEndpoint: '/api/lumaleasing/config',
    chatEndpoint: '/api/lumaleasing/chat',
    requiresEnvironmentSuppliedKey: true,
  },
  siteForge: {
    allowedOrigins: ['https://www.dividendhomes.com'],
    conversionConsent: {
      accepted: [true, 'true', '1', 'on'],
      rejected: [false, 'false', '0', 'off'],
      evidenceRequired: true,
    },
    analyticsConsentStates: [
      'unknown',
      'denied',
      'granted',
      'not_required',
    ],
    telemetry: {
      confirmedEvents: ['lead_submit', 'tour_booked'],
      respectsAnalyticsConsent: true,
    },
    compatibility: {
      artifactSchemaVersion: 1,
      runtimeContractVersion: 2,
      legacyThemeOption: 'oneclick_siteforge_lumaleasing',
      runtimeV2Option: 'oneclick_siteforge_public_runtime',
    },
    existingArtifactFeatureDefaults: {
      publicRuntime: false,
      analytics: false,
      chatbot: false,
      tours: false,
    },
  },
} as const

export type AcaciaRegressionBaselineV1 =
  typeof ACACIA_REGRESSION_BASELINE_V1
