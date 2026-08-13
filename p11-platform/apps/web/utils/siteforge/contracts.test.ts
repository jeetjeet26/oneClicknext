import { describe, expect, it } from 'vitest'
import {
  createGenerationRequestSchema,
  siteForgeGenerationEvidenceSnapshotSchema,
  siteForgePlanSchema,
} from './contracts'
import {
  canonicalizeSiteForgeContent,
  hashSiteForgeContent,
} from './content-hash'

const validPlan = {
  schemaVersion: 1 as const,
  propertyId: '11111111-1111-4111-8111-111111111111',
  name: 'Reference-quality launch',
  summary: 'A grounded multifamily marketing site.',
  siteType: 'standard' as const,
  preferences: {
    style: 'luxury' as const,
    ctaPriority: 'tours' as const,
    motion: 'subtle' as const,
    enabledCapabilities: [],
  },
  enabledCapabilities: [],
  brandDirection: {
    positioning: 'Modern coastal living',
    voice: 'Warm and composed',
    visualDirection: 'Editorial layouts with natural texture',
    mustInclude: [],
    mustAvoid: [],
  },
  audiences: [],
  pages: [
    {
      slug: 'home',
      title: 'Home',
      navLabel: 'Home',
      purpose: 'Introduce the property and drive tours.',
      sections: [
        {
          id: 'home-hero',
          label: 'Hero',
          purpose: 'Establish the property promise.',
          block: 'acf/top-slides' as const,
          required: true,
          factsRequired: [],
          evidenceIds: ['property-name'],
        },
      ],
    },
  ],
  conversionStrategy: {
    primaryAction: 'tours' as const,
    secondaryAction: 'contact' as const,
    leadDestination: 'p11_lumaleasing' as const,
    tourDestination: 'p11_lumaleasing' as const,
    requiredForms: ['tour' as const],
  },
  floorPlanStrategy: {
    source: 'property_units' as const,
    display: 'cards' as const,
    showPricing: true,
    showAvailability: true,
    freshnessHours: 168,
  },
  seoStrategy: {
    localSearchFocus: ['apartments'],
    structuredData: ['ApartmentComplex' as const],
  },
  analyticsStrategy: {
    enabled: true,
    consentMode: 'required' as const,
    events: ['page_view' as const, 'tour_start' as const],
  },
  accessibilityRequirements: ['WCAG 2.2 AA'],
  legalRequirements: ['Equal Housing Opportunity disclosure'],
  knownFacts: [
    {
      claim: 'The property name is verified.',
      evidenceIds: ['property-name'],
    },
  ],
  recommendations: [],
  unresolvedQuestions: [],
  evidence: [
    {
      id: 'property-name',
      sourceType: 'property' as const,
      sourceId: '11111111-1111-4111-8111-111111111111',
      label: 'Property record',
      capturedAt: '2026-07-30T17:00:00.000Z',
      confidence: 1,
      retrievalStatus: 'available' as const,
    },
  ],
}

describe('SiteForge contracts', () => {
  it('accepts a complete structured plan', () => {
    expect(siteForgePlanSchema.parse(validPlan)).toEqual(validPlan)
  })

  it('accepts canonical Postgres UUIDs used by legacy properties', () => {
    expect(
      siteForgePlanSchema.parse({
        ...validPlan,
        propertyId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      }).propertyId
    ).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  })

  it('accepts PostgreSQL GUID identities in generation evidence', () => {
    expect(
      siteForgeGenerationEvidenceSnapshotSchema.shape.brand.shape.assetId.parse(
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      )
    ).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  })

  it('rejects generation without an approved plan identity', () => {
    expect(() =>
      createGenerationRequestSchema.parse({
        planId: validPlan.propertyId,
        confirmedRevision: 1,
      })
    ).toThrow()
  })

  it('requires the pre-existing website that owns approved generation evidence', () => {
    expect(
      createGenerationRequestSchema.parse({
        websiteId: '22222222-2222-4222-8222-222222222222',
        planId: validPlan.propertyId,
        confirmedRevision: 1,
        contentHash: 'a'.repeat(64),
        idempotencyKey: 'generation-request-1',
      })
    ).toMatchObject({
      websiteId: '22222222-2222-4222-8222-222222222222',
      planId: validPlan.propertyId,
    })
    expect(() =>
      createGenerationRequestSchema.parse({
        planId: validPlan.propertyId,
        confirmedRevision: 1,
        contentHash: 'a'.repeat(64),
        idempotencyKey: 'generation-request-1',
      })
    ).toThrow()
  })

  it('hashes semantically identical objects identically', () => {
    const first = { b: 2, a: { y: 2, x: 1 } }
    const second = { a: { x: 1, y: 2 }, b: 2 }

    expect(canonicalizeSiteForgeContent(first)).toBe(
      canonicalizeSiteForgeContent(second)
    )
    expect(hashSiteForgeContent(first)).toBe(hashSiteForgeContent(second))
    expect(hashSiteForgeContent(first)).toHaveLength(64)
  })
})
