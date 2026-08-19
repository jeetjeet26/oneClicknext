import type {
  ForSaleOfferingGraph,
  ForSalePublicationPolicy,
} from '@/utils/real-estate/contracts'

const observedAt = '2026-08-17T12:00:00.000Z'
const source = (externalId: string) => ({
  provider: 'builder_feed',
  externalId,
  observedAt,
})

export const MULTIFAMILY_OFFERING_FIXTURE_V1 = {
  canonical_key: 'aspen-a1',
  unit_type: 'Aspen',
  bedrooms: 1,
  bathrooms: 1,
  rent_min: 1_895,
  available_count: 2,
  source: 'yardi',
  source_identity: 'yardi:aspen-a1',
  source_updated_at: observedAt,
} as const

export const FOR_SALE_OFFERING_GRAPH_FIXTURE_V1 = {
  schemaVersion: 1,
  transaction: 'for_sale',
  nodes: [
    { key: 'community:cedar', kind: 'community', name: 'Cedar', attributes: {}, sources: [source('community-1')] },
    { key: 'neighborhood:grove', kind: 'neighborhood', name: 'The Grove', attributes: {}, sources: [source('neighborhood-1')] },
    { key: 'collection:heritage', kind: 'home_collection', name: 'Heritage', attributes: {}, sources: [source('collection-1')] },
    { key: 'plan:aspen', kind: 'plan', name: 'Aspen', attributes: { bedrooms: 3 }, sources: [source('plan-1')] },
    { key: 'elevation:aspen-modern', kind: 'elevation', name: 'Modern', attributes: {}, sources: [source('elevation-1')] },
    { key: 'qmi:lot-42', kind: 'quick_move_in_home', name: 'Aspen on Lot 42', attributes: {}, sources: [source('qmi-42')] },
    { key: 'homesite:42', kind: 'homesite', name: 'Homesite 42', attributes: {}, sources: [source('homesite-42')] },
    { key: 'builder:acme', kind: 'builder', name: 'Acme Homes', attributes: {}, sources: [source('builder-1')] },
  ],
  edges: [
    { from: 'community:cedar', to: 'neighborhood:grove', relation: 'contains' },
    { from: 'neighborhood:grove', to: 'collection:heritage', relation: 'contains' },
    { from: 'collection:heritage', to: 'plan:aspen', relation: 'offers' },
    { from: 'elevation:aspen-modern', to: 'plan:aspen', relation: 'variant_of' },
    { from: 'qmi:lot-42', to: 'plan:aspen', relation: 'variant_of' },
    { from: 'qmi:lot-42', to: 'homesite:42', relation: 'located_in' },
    { from: 'qmi:lot-42', to: 'builder:acme', relation: 'built_by' },
  ],
  pricing: [
    {
      offeringKey: 'plan:aspen',
      qualifier: 'from',
      currency: 'USD',
      amount: 525_000,
      maxAmount: null,
      disclosure: 'Base price; options and homesite premiums are additional.',
      observedAt,
      expiresAt: '2026-08-18T12:00:00.000Z',
      source: source('price-plan-1'),
    },
  ],
  availability: [
    {
      offeringKey: 'qmi:lot-42',
      state: 'available',
      quantity: 1,
      observedAt,
      expiresAt: '2026-08-18T12:00:00.000Z',
      source: source('availability-qmi-42'),
    },
  ],
  lifecycleStates: [
    {
      offeringKey: 'qmi:lot-42',
      releaseState: 'released',
      constructionState: 'under_construction',
      observedAt,
      expiresAt: '2026-08-25T12:00:00.000Z',
      source: source('lifecycle-qmi-42'),
    },
  ],
  disclosures: [],
} as const satisfies ForSaleOfferingGraph

export const FOR_SALE_PUBLICATION_POLICY_FIXTURE_V1 = {
  schemaVersion: 1,
  maxAgeHours: {
    pricing: 24,
    availability: 24,
    release: 168,
    construction: 168,
  },
  staleAction: 'disclose',
  omitUnknownAvailability: true,
  requiredDisclosures: [
    {
      code: 'pricing_subject_to_change',
      text: 'Prices, availability, and construction timing are subject to change without notice.',
      offeringKeys: [],
    },
  ],
} as const satisfies ForSalePublicationPolicy
