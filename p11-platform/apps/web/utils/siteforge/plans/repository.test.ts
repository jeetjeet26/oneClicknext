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
import type { SiteForgePlan } from '@/utils/siteforge/contracts'
import {
  decideSiteForgePlan,
  loadApprovedSiteForgeGenerationContext,
  pinModifiedPlanSources,
  preservePinnedPlanSources,
  siteForgePlanRequirements,
} from './repository'

const { recordApprovalDecisionMock } = vi.hoisted(() => ({
  recordApprovalDecisionMock: vi.fn(),
}))

vi.mock('@/utils/services/shared-approvals', () => ({
  recordSharedApprovalDecision: recordApprovalDecisionMock,
}))

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
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
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
  assetError?: { message: string }
  inventoryError?: { message: string }
  optionalSources?: boolean
} = {}) {
  const plan = planFixture() as SiteForgePlan
  if (overrides.optionalSources) {
    plan.pages = [{
      slug: 'about',
      title: 'About',
      navLabel: 'About',
      purpose: 'Present grounded property information.',
      sections: [{
        id: 'about-copy',
        label: 'About copy',
        purpose: 'Explain approved property facts.',
        block: 'acf/text-section' as const,
        required: true,
        factsRequired: [],
        evidenceIds: ['inventory'],
      }],
    }]
  }
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
        website_id: ids.website,
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
          asset_role: 'primary_logo',
          asset_type: 'image',
          file_url: 'https://cdn.example.com/logo.svg',
          content_hash: 'e'.repeat(64),
          rights_status: 'owned',
          rights_metadata: { license: 'operator-owned' },
          approval_status: 'approved',
          curation_status: 'approved',
          duplicate_of: null,
          expires_at: null,
        },
      ],
      error: overrides.assetError ?? null,
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
        // A display preference must not make optional live availability a
        // generation prerequisite for otherwise valid manual inventory.
        available_count: null,
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
      error: overrides.inventoryError ?? null,
    }),
  }
  return {
    client: { from: vi.fn((table: string) => tables[table]) } as never,
    contentHash: planHash,
    tables,
  }
}

describe('loadApprovedSiteForgeGenerationContext', () => {
  it('builds one hash-bound evidence snapshot from approved generation truth', async () => {
    const { client, contentHash, tables } = arrange()

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
    expect(tables.siteforge_plans.eq).toHaveBeenCalledWith(
      'website_id',
      ids.website
    )
    expect(tables.siteforge_plans.eq).toHaveBeenCalledWith(
      'property_id',
      ids.property
    )
    expect(tables.siteforge_plans.eq).toHaveBeenCalledWith('org_id', ids.org)
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

  it('fails closed for synthetic-only required inventory', async () => {
    const { client, contentHash } = arrange({
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
    ).rejects.toThrow('requires approved floor-plan inventory')
  })

  it('allows an empty asset manifest when chosen pages need no media', async () => {
    const { client, contentHash } = arrange({
      assets: [],
      optionalSources: true,
    })
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

    expect(context.evidenceSnapshot.assetManifest).toEqual({
      required: false,
      assets: [],
      contentHash: hashSiteForgeContent([]),
    })
  })

  it('degrades unavailable optional assets and inventory to empty evidence', async () => {
    const { client, contentHash } = arrange({
      optionalSources: true,
      assetError: { message: 'assets unavailable' },
      inventoryError: { message: 'inventory unavailable' },
    })
    const context = await loadApprovedSiteForgeGenerationContext(
      {
        websiteId: ids.website,
        planId: ids.plan,
        confirmedRevision: 1,
        contentHash,
      },
      client,
      new Date('2026-08-10T13:00:00.000Z'),
    )

    expect(context.evidenceSnapshot.assetManifest).toMatchObject({
      required: false,
      assets: [],
    })
    expect(context.evidenceSnapshot.schemaVersion).toBe(1)
    if (context.evidenceSnapshot.schemaVersion !== 1) {
      throw new Error('Expected legacy generation evidence')
    }
    expect(context.evidenceSnapshot.inventory).toMatchObject({
      required: false,
      rowCount: 0,
    })
  })

  it('fails closed when required inventory cannot be loaded', async () => {
    const { client, contentHash } = arrange({
      inventoryError: { message: 'inventory unavailable' },
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
        new Date('2026-08-10T13:00:00.000Z'),
      )
    ).rejects.toThrow('Failed to load approved inventory evidence')
  })
})

describe('SiteForge plan integrity helpers', () => {
  it('derives optional asset and inventory requirements from chosen pages', () => {
    expect(
      siteForgePlanRequirements({
        pages: [{
          sections: [{ block: 'acf/text-section' }],
        }],
      })
    ).toEqual({ assets: false, inventory: false, catalog: false })
    expect(
      siteForgePlanRequirements({
        pages: [{
          sections: [
            { block: 'acf/gallery' },
            { block: 'acf/plans-availability' },
          ],
        }],
      })
    ).toEqual({ assets: true, inventory: true, catalog: false })
    expect(
      siteForgePlanRequirements({
        pages: [{
          sections: [
            { block: 'acf/gallery', required: false },
            { block: 'acf/plans-availability', required: false },
          ],
        }],
      })
    ).toEqual({ assets: false, inventory: false, catalog: false })
  })

  it('preserves every pinned onboarding and brand source on modification', () => {
    const sources = {
      onboarding_snapshot_id: ids.onboarding,
      onboarding_snapshot_hash: onboardingHash,
      brand_asset_id: ids.brand,
      brand_contract_version: '1.0',
      brand_contract_hash: brandHash,
    }
    expect(preservePinnedPlanSources(sources)).toEqual(sources)
  })

  it('rejects conflicting embedded identities and restores omitted pinned sources', () => {
    const current = planFixture()
    expect(() =>
      pinModifiedPlanSources(
        {
          ...current,
          onboardingSnapshot: {
            ...current.onboardingSnapshot,
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          },
        },
        current,
      )
    ).toThrow('onboarding identity')

    const withoutSources = Object.fromEntries(
      Object.entries(current).filter(
        ([key]) => !['onboardingSnapshot', 'brandSnapshot'].includes(key)
      )
    )
    const pinned = pinModifiedPlanSources(
      { ...withoutSources, summary: 'Reviewer-modified summary.' },
      current,
    )
    expect(pinned.onboardingSnapshot).toEqual(current.onboardingSnapshot)
    expect(pinned.brandSnapshot).toEqual(current.brandSnapshot)
  })

  it('inserts a modified revision with canonical embedded and DB source identities', async () => {
    const current = planFixture()
    const priorSources = {
      context_snapshot_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      conversation_history: [],
      onboarding_snapshot_id: ids.onboarding,
      onboarding_snapshot_hash: onboardingHash,
      brand_asset_id: ids.brand,
      brand_contract_version: '1.0',
      brand_contract_hash: brandHash,
    }
    const insertedVersions: Array<Record<string, unknown>> = []
    const planRead = query({
      data: {
        id: ids.plan,
        website_id: ids.website,
        property_id: ids.property,
        org_id: ids.org,
        current_revision: 1,
        status: 'ready_for_review',
        approval_action_attempt_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      },
      error: null,
    })
    const currentVersion = query({
      data: {
        id: ids.version,
        plan: current,
        readiness_report: {
          ready: true,
          evaluatedAt: '2026-08-10T12:00:00.000Z',
          policyVersion: 'test-v1',
          issues: [],
        },
        content_hash: hashSiteForgeContent(current),
      },
      error: null,
    })
    const approvalAttempt = query({
      data: {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        proposal_decision_status: 'proposed',
      },
      error: null,
    })
    const priorVersion = query({ data: priorSources, error: null })
    const versionInsert = query({
      data: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
      error: null,
    })
    versionInsert.insert = vi.fn((value: Record<string, unknown>) => {
      insertedVersions.push(value)
      return versionInsert
    })
    const planUpdate = query({ data: { id: ids.plan }, error: null })
    planUpdate.update = vi.fn(() => planUpdate)
    let planCalls = 0
    let versionCalls = 0
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'siteforge_plans') {
          planCalls += 1
          return planCalls === 1 ? planRead : planUpdate
        }
        if (table === 'shared_action_attempts') return approvalAttempt
        if (table === 'siteforge_plan_versions') {
          versionCalls += 1
          if (versionCalls === 1) return currentVersion
          if (versionCalls === 2) return priorVersion
          return versionInsert
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }
    recordApprovalDecisionMock.mockResolvedValue({
      approval: { id: 'abababab-abab-4bab-8bab-abababababab' },
    })
    const modified = {
      ...current,
      summary: 'Reviewer-modified summary.',
      onboardingSnapshot: undefined,
      brandSnapshot: undefined,
    }

    const result = await decideSiteForgePlan(
      {
        planId: ids.plan,
        websiteId: ids.website,
        propertyId: ids.property,
        orgId: ids.org,
        expectedRevision: 1,
        contentHash: hashSiteForgeContent(current),
        reviewerProfileId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
        decisionStatus: 'modified',
        decisionReason: 'Clarify the approved summary.',
        modifiedPlan: modified,
      },
      client as never,
    )

    expect(result.revision).toBe(2)
    expect(insertedVersions).toHaveLength(1)
    expect(insertedVersions[0]).toMatchObject({
      plan_id: ids.plan,
      revision: 2,
      onboarding_snapshot_id: ids.onboarding,
      onboarding_snapshot_hash: onboardingHash,
      brand_asset_id: ids.brand,
      brand_contract_version: '1.0',
      brand_contract_hash: brandHash,
      plan: expect.objectContaining({
        onboardingSnapshot: current.onboardingSnapshot,
        brandSnapshot: current.brandSnapshot,
      }),
    })
  })

  it('rejects a plan outside the requested website and organization boundary', async () => {
    recordApprovalDecisionMock.mockClear()
    const scopedPlanQuery = query({
      data: null,
      error: { message: 'not found' },
    })
    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'siteforge_plans') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return scopedPlanQuery
      }),
    }
    const otherWebsite = '12121212-1212-4212-8212-121212121212'
    const otherOrg = '34343434-3434-4434-8434-343434343434'

    await expect(
      decideSiteForgePlan(
        {
          planId: ids.plan,
          websiteId: otherWebsite,
          propertyId: ids.property,
          orgId: otherOrg,
          expectedRevision: 1,
          contentHash: 'a'.repeat(64),
          reviewerProfileId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
          decisionStatus: 'approved',
          decisionReason: 'Approve.',
        },
        client as never,
      )
    ).rejects.toThrow('SiteForge plan not found')
    expect(scopedPlanQuery.eq).toHaveBeenCalledWith('website_id', otherWebsite)
    expect(scopedPlanQuery.eq).toHaveBeenCalledWith('org_id', otherOrg)
    expect(recordApprovalDecisionMock).not.toHaveBeenCalled()
  })
})
