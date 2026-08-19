import { z } from 'zod'
import type { Json } from '@/types/supabase'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export const jsonValueSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
)

export const propertySubjectKindSchema = z.enum([
  'real_estate_property',
  'real_estate_development',
  'real_estate_portfolio',
  'business_location',
  'other',
])

export const verticalMappingStatusSchema = z.enum([
  'confirmed',
  'needs_review',
])

export const verticalKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,63}$/)

export const verticalPackIdentitySchema = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
    version: z.number().int().positive(),
  })
  .strict()

const offeringGraphKeySchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:-]+$/)

export const forSaleOfferingNodeKindSchema = z.enum([
  'community',
  'neighborhood',
  'home_collection',
  'plan',
  'elevation',
  'quick_move_in_home',
  'homesite',
  'builder',
])

export const forSaleOfferingSourceSchema = z
  .object({
    provider: z.string().trim().min(1).max(120),
    externalId: z.string().trim().min(1).max(240),
    observedAt: z.string().datetime(),
  })
  .strict()

export const forSaleOfferingNodeSchema = z
  .object({
    key: offeringGraphKeySchema,
    kind: forSaleOfferingNodeKindSchema,
    name: z.string().trim().min(1).max(240),
    attributes: z.record(z.string(), jsonValueSchema).default({}),
    sources: z.array(forSaleOfferingSourceSchema).min(1).max(20),
  })
  .strict()

export const forSaleOfferingEdgeSchema = z
  .object({
    from: offeringGraphKeySchema,
    to: offeringGraphKeySchema,
    relation: z.enum([
      'contains',
      'offers',
      'variant_of',
      'built_by',
      'located_in',
    ]),
  })
  .strict()

const datedOfferingFactSchema = z.object({
  offeringKey: offeringGraphKeySchema,
  observedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  source: forSaleOfferingSourceSchema,
})

export const forSalePricingSchema = datedOfferingFactSchema
  .extend({
    qualifier: z.enum(['exact', 'from', 'range', 'base', 'contact_for_price']),
    currency: z.string().trim().length(3).default('USD'),
    amount: z.number().nonnegative().nullable(),
    maxAmount: z.number().nonnegative().nullable().default(null),
    disclosure: z.string().trim().min(1).max(1_000).nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.qualifier !== 'contact_for_price' && value.amount === null) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Published pricing requires an amount',
      })
    }
    if (
      value.maxAmount !== null &&
      value.amount !== null &&
      value.maxAmount < value.amount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['maxAmount'],
        message: 'Maximum price cannot be lower than the starting price',
      })
    }
  })

export const forSaleAvailabilitySchema = datedOfferingFactSchema
  .extend({
    state: z.enum([
      'available',
      'reserved',
      'under_contract',
      'sold',
      'unreleased',
      'waitlist',
      'unknown',
    ]),
    quantity: z.number().int().nonnegative().nullable().default(null),
  })
  .strict()

export const forSaleLifecycleStateSchema = datedOfferingFactSchema
  .extend({
    releaseState: z
      .enum(['announced', 'preview', 'released', 'sold_out', 'paused', 'withdrawn'])
      .nullable(),
    constructionState: z
      .enum([
        'planned',
        'permitted',
        'under_construction',
        'complete',
        'move_in_ready',
        'unknown',
      ])
      .nullable(),
  })
  .strict()
  .refine(
    value => value.releaseState !== null || value.constructionState !== null,
    { message: 'A release or construction state is required' }
  )

export const forSaleDisclosureSchema = z
  .object({
    code: offeringGraphKeySchema,
    text: z.string().trim().min(1).max(2_000),
    offeringKeys: z.array(offeringGraphKeySchema).max(500).default([]),
  })
  .strict()

export const forSaleOfferingGraphSchema = z
  .object({
    schemaVersion: z.literal(1),
    transaction: z.literal('for_sale'),
    nodes: z.array(forSaleOfferingNodeSchema).min(1).max(10_000),
    edges: z.array(forSaleOfferingEdgeSchema).max(50_000).default([]),
    pricing: z.array(forSalePricingSchema).max(20_000).default([]),
    availability: z.array(forSaleAvailabilitySchema).max(20_000).default([]),
    lifecycleStates: z.array(forSaleLifecycleStateSchema).max(20_000).default([]),
    disclosures: z.array(forSaleDisclosureSchema).max(500).default([]),
  })
  .strict()
  .superRefine((graph, context) => {
    const keys = new Set<string>()
    graph.nodes.forEach((node, index) => {
      if (keys.has(node.key)) {
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'key'],
          message: `Duplicate offering node key: ${node.key}`,
        })
      }
      keys.add(node.key)
    })
    const references = [
      ...graph.edges.flatMap(edge => [edge.from, edge.to]),
      ...graph.pricing.map(item => item.offeringKey),
      ...graph.availability.map(item => item.offeringKey),
      ...graph.lifecycleStates.map(item => item.offeringKey),
      ...graph.disclosures.flatMap(item => item.offeringKeys),
    ]
    for (const key of references) {
      if (!keys.has(key)) {
        context.addIssue({
          code: 'custom',
          message: `Offering graph references unknown node: ${key}`,
        })
      }
    }
  })

export const forSalePublicationPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    maxAgeHours: z
      .object({
        pricing: z.number().int().positive(),
        availability: z.number().int().positive(),
        release: z.number().int().positive(),
        construction: z.number().int().positive(),
      })
      .strict(),
    staleAction: z.enum(['omit', 'disclose']),
    omitUnknownAvailability: z.boolean().default(true),
    requiredDisclosures: z.array(forSaleDisclosureSchema).max(100).default([]),
  })
  .strict()

export const propertyVerticalProfileSchema = z
  .object({
    schemaVersion: z.literal(2),
    subjectKind: propertySubjectKindSchema,
    verticalKey: verticalKeySchema,
    displayName: z.string().trim().min(1).max(160),
    operatingModel: z.string().trim().min(1).max(120),
    attributes: z.record(z.string(), jsonValueSchema).default({}),
    audiences: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    complianceTags: z
      .array(z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,127}$/))
      .max(50)
      .default([]),
    source: z.enum(['operator', 'legacy_property_type', 'import', 'system']),
    legacyPropertyType: z.string().trim().max(80).nullable().optional(),
  })
  .strict()

export const createPropertyVerticalProfileSchema = z
  .object({
    profile: propertyVerticalProfileSchema,
    mappingStatus: verticalMappingStatusSchema.default('confirmed'),
    mappingReason: z.string().trim().min(10).max(2_000).nullable().optional(),
    verticalPack: verticalPackIdentitySchema,
    expectedVersion: z.number().int().nonnegative().nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.mappingStatus === 'needs_review' &&
      !value.mappingReason?.trim()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['mappingReason'],
        message: 'A mapping reason is required when review is needed',
      })
    }
  })

export const verticalContextIdentitySchema = z
  .object({
    profile: z.object({
      id: z.guid(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    pack: z.object({
      key: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
      version: z.number().int().positive(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    offering: z
      .object({
        versionId: z.guid(),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .nullable(),
    availability: z
      .object({
        snapshotId: z.guid(),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .nullable(),
    policy: z
      .object({
        versionId: z.guid(),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .nullable(),
  })
  .strict()

export type PropertySubjectKind = z.infer<typeof propertySubjectKindSchema>
export type PropertyVerticalProfile = z.infer<
  typeof propertyVerticalProfileSchema
>
export type CreatePropertyVerticalProfile = z.infer<
  typeof createPropertyVerticalProfileSchema
>
export type VerticalContextIdentity = z.infer<
  typeof verticalContextIdentitySchema
>
export type ForSaleOfferingGraph = z.infer<typeof forSaleOfferingGraphSchema>
export type ForSalePublicationPolicy = z.infer<
  typeof forSalePublicationPolicySchema
>

export function hashVerticalPackIdentity(
  pack: z.infer<typeof verticalPackIdentitySchema>
): string {
  return hashSiteForgeContent({
    packKey: pack.key,
    packVersion: pack.version,
  })
}

export function hashPropertyVerticalProfile(
  profile: PropertyVerticalProfile
): string {
  return hashSiteForgeContent(propertyVerticalProfileSchema.parse(profile))
}

export function hashPropertyVerticalProfileVersion(
  value: CreatePropertyVerticalProfile
): string {
  const parsed = createPropertyVerticalProfileSchema.parse(value)
  return hashSiteForgeContent({
    schemaVersion: 2,
    profile: parsed.profile,
    mappingStatus: parsed.mappingStatus,
    mappingReason: parsed.mappingReason?.trim() || null,
    verticalPack: parsed.verticalPack,
  })
}

export function verticalIdentityColumns(identity: VerticalContextIdentity) {
  const parsed = verticalContextIdentitySchema.parse(identity)
  return {
    vertical_profile_version_id: parsed.profile.id,
    vertical_profile_content_hash: parsed.profile.contentHash,
    vertical_pack_key: parsed.pack.key,
    vertical_pack_version: parsed.pack.version,
    vertical_pack_content_hash: parsed.pack.contentHash,
    offering_version_id: parsed.offering?.versionId ?? null,
    offering_content_hash: parsed.offering?.contentHash ?? null,
    availability_snapshot_id: parsed.availability?.snapshotId ?? null,
    availability_content_hash: parsed.availability?.contentHash ?? null,
    policy_version_id: parsed.policy?.versionId ?? null,
    policy_content_hash: parsed.policy?.contentHash ?? null,
  }
}
