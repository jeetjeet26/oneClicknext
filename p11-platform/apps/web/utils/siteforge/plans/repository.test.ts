import { describe, expect, it, vi } from 'vitest'
import {
  brandContractToStorageSections,
  hashBrandForgeContract,
  normalizeBrandForgeContract,
} from '@/utils/brandforge/normalize'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { hashSiteForgeBrief } from '@/utils/siteforge/briefs/contracts'
import {
  hashSiteForgeDirection,
  hashSiteForgeDirectionSet,
} from '@/utils/siteforge/directions/contracts'
import { loadApprovedSiteForgeGenerationContext } from './repository'

const ids = {
  website: '11111111-1111-4111-8111-111111111111',
  property: '22222222-2222-4222-8222-222222222222',
  org: '33333333-3333-4333-8333-333333333333',
  plan: '44444444-4444-4444-8444-444444444444',
  version: '55555555-5555-4555-8555-555555555555',
  onboarding: '66666666-6666-4666-8666-666666666666',
  brand: '77777777-7777-4777-8777-777777777777',
  brief: '88888888-8888-4888-8888-888888888888',
  directionSet: '99999999-9999-4999-8999-999999999999',
  direction: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  asset: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

const brandContract = normalizeBrandForgeContract(
  {
    identity: { name: 'Evidence Apartments' },
    logos: {
      variants: [{
        role: 'primary',
        assetId: ids.asset,
        url: 'https://cdn.example.com/logo.svg',
        alt: 'Evidence Apartments logo',
        restrictions: [],
      }],
    },
    colors: {
      roles: [
        { role: 'primary', name: 'Ink', hex: '#112233', usage: 'Primary' },
        { role: 'secondary', name: 'Sand', hex: '#DDBB99', usage: 'Secondary' },
        { role: 'accent', name: 'Leaf', hex: '#557755', usage: 'Accent' },
      ],
    },
    typography: {
      roles: [
        {
          role: 'headline',
          family: 'Inter',
          weights: [700],
          usage: 'Headlines',
          fallback: 'Arial, sans-serif',
        },
        {
          role: 'body',
          family: 'Inter',
          weights: [400],
          usage: 'Body',
          fallback: 'Arial, sans-serif',
        },
      ],
    },
  },
  { origin: 'imported', approvalStatus: 'approved' }
)
const brandHash = hashBrandForgeContract(brandContract)
const onboardingHash = 'c'.repeat(64)

function briefFixture() {
  return {
    title: 'Evidence Apartments website',
    summary: 'Create a verified leasing website.',
    objectives: [{
      statement: 'Increase qualified tours.',
      priority: 'primary' as const,
      successSignal: 'More completed tour requests.',
    }],
    audiences: [{
      segment: 'Prospective residents',
      needs: ['Verified pricing and availability'],
      objections: ['Unclear current inventory'],
    }],
    conversion: {
      primaryAction: 'Schedule a tour',
      secondaryActions: ['Contact leasing'],
      funnelNotes: 'Lead with verified inventory.',
    },
    scope: {
      includedPages: ['Floor Plans'],
      excludedItems: [],
    },
    stakeholders: [],
    approvers: [],
    launchTarget: {
      targetDate: null,
      timezone: 'America/Los_Angeles',
      flexibility: 'flexible' as const,
    },
    legalConstraints: [],
    integrationConstraints: [],
    references: [],
    kpis: [],
  }
}

function directionFixture(
  ordinal: number,
  briefContentHash: string,
  name = ordinal === 1 ? 'Warm editorial' : 'Crisp modern'
) {
  const direction = {
    rationale: `${name} supports verified leasing decisions.`,
    typography: {
      headingFamily: 'Inter',
      bodyFamily: 'Inter',
      scale: 'Modular',
      weightStrategy: 'Strong headings',
    },
    palette: {
      primary: ordinal === 1 ? '#112233' : '#223344',
      secondary: '#DDBB99',
      accent: '#557755',
      background: '#FFFFFF',
      text: '#111111',
    },
    hero: {
      composition: ordinal === 1 ? 'Full bleed' : 'Split layout',
      headlineStyle: 'Direct',
      mediaTreatment: 'Approved photography',
    },
    layout: {
      system: ordinal === 1 ? 'Editorial grid' : 'Structured grid',
      density: 'Balanced',
      sectionRhythm: 'Measured',
    },
    imagery: {
      style: 'Authentic property photography',
      subjects: ['Approved property exterior'],
      treatment: 'Natural color',
    },
    cta: {
      label: 'Schedule a tour',
      placement: 'Hero and navigation',
      style: 'Primary button',
    },
    voice: {
      traits: ['Warm', 'Clear'],
      do: ['Use verified facts'],
      dont: ['Invent claims'],
    },
    tradeoffs: ['Prioritizes clarity over decorative density'],
    provenance: {
      generator: 'siteforge-deterministic-directions-v1' as const,
      briefVersionId: ids.brief,
      briefContentHash,
      onboardingSnapshotId: ids.onboarding,
      onboardingSnapshotHash: onboardingHash,
      brandAssetId: ids.brand,
      brandContractHash: brandHash,
    },
  }
  const previewManifest = {
    paletteSwatches: [
      direction.palette.primary,
      direction.palette.secondary,
      direction.palette.accent,
      direction.palette.background,
      direction.palette.text,
    ],
    heroMode: direction.hero.composition,
    layoutMode: direction.layout.system,
    typographyPairing: 'Inter / Inter',
  }
  return {
    id: ordinal === 1 ? ids.direction : 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    direction_set_id: ids.directionSet,
    ordinal,
    name,
    direction,
    preview_manifest: previewManifest,
    content_hash: hashSiteForgeDirection({
      name,
      ordinal,
      direction,
      previewManifest,
    }),
  }
}

function planFixture() {
  return {
    schemaVersion: 1 as const,
    siteType: 'standard' as const,
    propertyId: ids.property,
    onboardingSnapshot: {
      id: ids.onboarding,
      contentHash: onboardingHash,
      enabledCapabilities: [],
    },
    brandSnapshot: {
      assetId: ids.brand,
      contractVersion: '1.0' as const,
      contractHash: brandHash,
      origin: brandContract.origin,
      contract: brandContract,
    },
    enabledCapabilities: [],
    name: 'Approved website plan',
    summary: 'Generate the approved apartment website.',
    preferences: { motion: 'subtle' as const, enabledCapabilities: [] },
    brandDirection: {
      positioning: 'Verified positioning',
      voice: 'Warm',
      visualDirection: 'Editorial',
      mustInclude: [],
      mustAvoid: [],
    },
    audiences: [],
    pages: [{
      slug: 'floor-plans',
      title: 'Floor Plans',
      navLabel: 'Floor Plans',
      purpose: 'Publish verified inventory.',
      sections: [{
        id: 'plans',
        label: 'Floor plans',
        purpose: 'Show approved floor plans.',
        block: 'acf/plans-availability' as const,
        required: true,
        factsRequired: [],
        evidenceIds: ['inventory'],
      }],
    }],
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
      freshnessHours: 24,
    },
    seoStrategy: {
      localSearchFocus: ['apartments'],
      structuredData: ['ApartmentComplex' as const],
    },
    analyticsStrategy: {
      enabled: true,
      consentMode: 'required' as const,
      events: ['page_view' as const],
    },
    accessibilityRequirements: [],
    legalRequirements: [],
    knownFacts: [{ claim: 'Inventory is approved.', evidenceIds: ['inventory'] }],
    recommendations: [],
    unresolvedQuestions: [],
    evidence: [{
      id: 'inventory',
      sourceType: 'property_unit' as const,
      sourceId: 'aspen-a1',
      label: 'Approved inventory',
      capturedAt: '2026-08-10T12:00:00.000Z',
      sourceUpdatedAt: '2026-08-10T12:00:00.000Z',
      confidence: 1,
      retrievalStatus: 'available' as const,
    }],
  }
}

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn().mockResolvedValue(result)
  builder.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject)
  return builder
}

function arrange(overrides: {
  direction?: Record<string, unknown>
  assets?: unknown[]
  inventory?: unknown[]
} = {}) {
  const plan = planFixture()
  const planHash = hashSiteForgeContent(plan)
  const brief = briefFixture()
  const briefHash = hashSiteForgeBrief({
    brief,
    unresolvedContradictions: [],
    sources: {
      onboardingSnapshotId: ids.onboarding,
      onboardingSnapshotHash: onboardingHash,
      brandAssetId: ids.brand,
      brandContractHash: brandHash,
    },
  })
  const directionRows = [
    directionFixture(1, briefHash),
    directionFixture(2, briefHash),
  ]
  if (overrides.direction) {
    directionRows[0] = {
      ...directionRows[0],
      direction: overrides.direction as never,
    }
  }
  const directionSetHash = hashSiteForgeDirectionSet({
    briefVersionId: ids.brief,
    briefContentHash: briefHash,
    directionHashes: directionRows.map(direction => direction.content_hash),
    selectedDirectionHash: directionRows[0].content_hash,
    selectionNotes: 'Approved',
  })
  const tables: Record<string, ReturnType<typeof query>> = {
    property_websites: query({
      data: { id: ids.website, property_id: ids.property, org_id: ids.org },
      error: null,
    }),
    siteforge_plans: query({
      data: {
        id: ids.plan,
        property_id: ids.property,
        org_id: ids.org,
        status: 'confirmed',
        current_revision: 1,
        confirmed_version_id: ids.version,
      },
      error: null,
    }),
    siteforge_plan_versions: query({
      data: {
        id: ids.version,
        plan_id: ids.plan,
        revision: 1,
        plan,
        readiness_report: {
          ready: true,
          evaluatedAt: '2026-08-10T12:00:00.000Z',
          policyVersion: 'generation-v1',
          issues: [],
        },
        content_hash: planHash,
        onboarding_snapshot_id: ids.onboarding,
        onboarding_snapshot_hash: onboardingHash,
        brand_asset_id: ids.brand,
        brand_contract_version: '1.0',
        brand_contract_hash: brandHash,
      },
      error: null,
    }),
    property_onboarding_snapshots: query({
      data: {
        id: ids.onboarding,
        org_id: ids.org,
        property_id: ids.property,
        status: 'approved',
        content_hash: onboardingHash,
        brand_asset_id: ids.brand,
        brand_contract_version: '1.0',
        brand_contract_hash: brandHash,
      },
      error: null,
    }),
    property_brand_assets: query({
      data: {
        id: ids.brand,
        property_id: ids.property,
        approval_status: 'approved',
        generation_status: 'complete',
        contract_version: '1.0',
        contract_hash: brandHash,
        brand_origin: brandContract.origin,
        ...brandContractToStorageSections(brandContract),
      },
      error: null,
    }),
    siteforge_brief_versions: query({
      data: {
        id: ids.brief,
        version: 1,
        status: 'approved',
        brief,
        unresolved_contradictions: [],
        content_hash: briefHash,
        onboarding_snapshot_id: ids.onboarding,
        onboarding_snapshot_hash: onboardingHash,
        brand_asset_id: ids.brand,
        brand_contract_hash: brandHash,
      },
      error: null,
    }),
    siteforge_creative_direction_sets: query({
      data: {
        id: ids.directionSet,
        version: 1,
        status: 'approved',
        brief_version_id: ids.brief,
        selected_direction_id: ids.direction,
        selection_notes: 'Approved',
        content_hash: directionSetHash,
      },
      error: null,
    }),
    siteforge_creative_directions: query({
      data: directionRows,
      error: null,
    }),
    content_assets: query({
      data: overrides.assets ?? [
        {
          id: ids.asset,
          asset_role: 'hero',
          asset_type: 'image',
          file_url: 'https://cdn.example.com/hero.jpg',
          content_hash: 'e'.repeat(64),
          rights_status: 'owned',
          rights_metadata: { license: 'operator-owned' },
          approval_status: 'approved',
          curation_status: 'approved',
          duplicate_of: null,
          expires_at: null,
        },
        ...[
          ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'primary_logo'],
          ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'interior'],
          ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'exterior'],
        ].map(([id, role]) => ({
          id,
          asset_role: role,
          asset_type: 'image',
          file_url: `https://cdn.example.com/${role}.jpg`,
          content_hash: 'f'.repeat(64),
          rights_status: 'owned',
          rights_metadata: { license: 'operator-owned' },
          approval_status: 'approved',
          curation_status: 'approved',
          duplicate_of: null,
          expires_at: null,
        })),
      ],
      error: null,
    }),
    property_units: query({
      data: overrides.inventory ?? [{
        canonical_key: 'aspen-a1',
        unit_type: 'Aspen',
        bedrooms: 1,
        bathrooms: 1,
        sqft_min: 720,
        sqft_max: 760,
        rent_min: 1895,
        rent_max: 2095,
        available_count: 2,
        move_in_specials: null,
        floor_plan_image_url: null,
        floor_plan_image_alt: null,
        availability_url: 'https://property.example.com/availability',
        apply_url: 'https://property.example.com/apply',
        source: 'yardi',
        source_identity: 'yardi-property-42',
        effective_at: '2026-08-10T12:00:00.000Z',
        expires_at: '2026-08-11T12:00:00.000Z',
        source_updated_at: '2026-08-10T12:00:00.000Z',
        imported_at: '2026-08-10T12:05:00.000Z',
      }],
      error: null,
    }),
  }
  return {
    client: { from: vi.fn((table: string) => tables[table]) } as never,
    contentHash: planHash,
  }
}

describe('loadApprovedSiteForgeGenerationContext', () => {
  it('builds one hash-bound evidence snapshot from approved generation truth', async () => {
    const { client, contentHash } = arrange()

    const context = await loadApprovedSiteForgeGenerationContext(
      {
        websiteId: ids.website,
        planId: ids.plan,
        confirmedRevision: 1,
        contentHash,
      },
      client,
      new Date('2026-08-10T13:00:00.000Z')
    )

    expect(context.evidenceSnapshot).toMatchObject({
      brief: { id: ids.brief },
      creativeDirection: { directionId: ids.direction },
      onboarding: { id: ids.onboarding, contentHash: onboardingHash },
      brand: { assetId: ids.brand, contractHash: brandHash },
      assetManifest: {
        assets: expect.arrayContaining([
          expect.objectContaining({ id: ids.asset, rightsStatus: 'owned' }),
        ]),
      },
      inventory: { required: true, rowCount: 1 },
    })
    expect(context.evidenceSnapshot.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a selected creative direction whose payload hash changed', async () => {
    const { client, contentHash } = arrange({
      direction: { name: 'Changed after approval' },
    })

    await expect(
      loadApprovedSiteForgeGenerationContext(
        {
          websiteId: ids.website,
          planId: ids.plan,
          confirmedRevision: 1,
          contentHash,
        },
        client,
        new Date('2026-08-10T13:00:00.000Z')
      )
    ).rejects.toThrow('creative-direction hash')
  })

  it.each([
    {
      name: 'synthetic inventory',
      inventory: [{
        canonical_key: 'fake-a1',
        unit_type: 'Fake',
        bedrooms: 1,
        bathrooms: 1,
        sqft_min: 700,
        sqft_max: 700,
        rent_min: 1000,
        rent_max: 1000,
        available_count: 1,
        move_in_specials: null,
        floor_plan_image_url: null,
        floor_plan_image_alt: null,
        availability_url: null,
        apply_url: null,
        source: 'demo',
        source_identity: 'synthetic-seed',
        effective_at: '2026-08-10T12:00:00.000Z',
        expires_at: null,
        source_updated_at: '2026-08-10T12:00:00.000Z',
        imported_at: '2026-08-10T12:00:00.000Z',
      }],
      message: 'stale, synthetic, expired, or incomplete',
    },
    {
      name: 'missing rights-cleared assets',
      assets: [],
      message: 'asset manifest no longer satisfies readiness',
    },
  ])('fails closed for $name', async ({ inventory, assets, message }) => {
    const { client, contentHash } = arrange({ inventory, assets })

    await expect(
      loadApprovedSiteForgeGenerationContext(
        {
          websiteId: ids.website,
          planId: ids.plan,
          confirmedRevision: 1,
          contentHash,
        },
        client,
        new Date('2026-08-10T13:00:00.000Z')
      )
    ).rejects.toThrow(message)
  })
})
