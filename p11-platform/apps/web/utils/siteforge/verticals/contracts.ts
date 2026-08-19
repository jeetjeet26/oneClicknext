import { z } from 'zod'
import { ACF_BLOCK_TYPES } from '@/types/siteforge'

export const VERTICAL_PACK_LAYERS = [
  'core',
  'scope',
  'sector',
  'transaction',
  'archetype',
  'modifier',
  'lifecycle',
  'confirmed_override',
] as const

export const VERTICAL_SCOPES = [
  'property',
  'community',
  'development',
  'corporate',
  'portfolio',
  'destination',
] as const

export const VERTICAL_SECTORS = [
  'residential',
  'senior_care',
  'commercial',
  'cross_sector',
  'destination',
] as const

export const VERTICAL_TRANSACTIONS = [
  'rental',
  'for_sale',
  'care_services',
  'commercial_lease',
  'informational',
  'destination_booking',
] as const

export const VERTICAL_LIFECYCLES = [
  'operating',
  'prelaunch',
  'lease_up',
  'selling',
] as const

export const VERTICAL_OFFERING_KINDS = [
  'rental_unit',
  'bed_space',
  'rental_home',
  'home_plan',
  'quick_move_in_home',
  'homesite',
  'care_residence',
  'commercial_suite',
  'commercial_building',
  'land',
  'venue',
  'event',
  'portfolio_property',
] as const

export const VERTICAL_CONVERSION_INTENTS = [
  'inquiry',
  'tour',
  'visit',
  'private_appointment',
  'apply',
  'register_interest',
  'waitlist',
  'pricing_availability_request',
  'brochure_request',
  'broker_registration',
  'sales_inquiry',
  'commercial_leasing_inquiry',
  'rfp',
  'professional_referral',
  'directions',
  'external_booking',
] as const

export const VERTICAL_POLICY_CODES = [
  'fair_housing',
  'affordable_eligibility_waitlist',
  'hopa_55_plus',
  'care_licensing_services',
  'health_data_minimization',
  'pricing_availability',
  'renderings_construction',
  'financing_brokerage',
  'commercial_specifications',
  'investor_claims',
  'brand_licensing',
  'privacy_consent',
  'wcag_2_2_aa',
  'equal_housing_opportunity',
] as const

export const VERTICAL_SEO_SCHEMA_TYPES = [
  'WebPage',
  'BreadcrumbList',
  'FAQPage',
  'ApartmentComplex',
  'Residence',
  'SingleFamilyResidence',
  'Organization',
  'RealEstateAgent',
  'SeniorLiving',
  'LocalBusiness',
  'Place',
  'OfficeBuilding',
  'ShoppingCenter',
  'IndustrialBuilding',
  'EventVenue',
  'Event',
  'ItemList',
] as const

export const VERTICAL_ANALYTICS_OUTCOMES = [
  'qualified_inquiry',
  'tour_scheduled',
  'application_started',
  'registration_completed',
  'appointment_scheduled',
  'waitlist_joined',
  'brochure_requested',
  'broker_registered',
  'sales_lead_created',
  'leasing_lead_created',
  'rfp_submitted',
  'professional_referral_submitted',
  'directions_requested',
  'booking_started',
  'offering_viewed',
] as const

export const VERTICAL_EVIDENCE_KINDS = [
  'subject_identity',
  'brand',
  'location',
  'offering_catalog',
  'availability',
  'pricing',
  'amenities',
  'services',
  'licensing',
  'eligibility',
  'construction_status',
  'commercial_specifications',
  'portfolio_membership',
  'destination_programming',
  'brand_license',
] as const

export const verticalPackLayerSchema = z.enum(VERTICAL_PACK_LAYERS)
export const verticalScopeSchema = z.enum(VERTICAL_SCOPES)
export const verticalSectorSchema = z.enum(VERTICAL_SECTORS)
export const verticalTransactionSchema = z.enum(VERTICAL_TRANSACTIONS)
export const verticalLifecycleSchema = z.enum(VERTICAL_LIFECYCLES)
export const verticalOfferingKindSchema = z.enum(VERTICAL_OFFERING_KINDS)
export const verticalConversionIntentSchema = z.enum(
  VERTICAL_CONVERSION_INTENTS
)
export const verticalPolicyCodeSchema = z.enum(VERTICAL_POLICY_CODES)
export const verticalSeoSchemaTypeSchema = z.enum(VERTICAL_SEO_SCHEMA_TYPES)
export const verticalAnalyticsOutcomeSchema = z.enum(
  VERTICAL_ANALYTICS_OUTCOMES
)
export const verticalEvidenceKindSchema = z.enum(VERTICAL_EVIDENCE_KINDS)
export const verticalBlockKeySchema = z.enum(ACF_BLOCK_TYPES)

const stableIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(180)
  .regex(/^[a-z][a-z0-9_.-]+$/)

const nonEmptyUnique = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .array(schema)
    .min(1)
    .refine(values => new Set(values).size === values.length, {
      message: 'Values must be unique',
    })

const unique = <T extends z.ZodTypeAny>(schema: T) =>
  z.array(schema).refine(values => new Set(values).size === values.length, {
    message: 'Values must be unique',
  })

export const verticalApplicabilitySchema = z
  .object({
    scopes: nonEmptyUnique(verticalScopeSchema),
    sectors: nonEmptyUnique(verticalSectorSchema),
    transactions: nonEmptyUnique(verticalTransactionSchema),
    archetypes: nonEmptyUnique(stableIdSchema),
    lifecycles: nonEmptyUnique(verticalLifecycleSchema),
  })
  .strict()

export const verticalEvidenceRequirementSchema = z
  .object({
    id: stableIdSchema,
    kind: verticalEvidenceKindSchema,
    description: z.string().trim().min(5).max(500),
    maxAgeHours: z.number().int().positive().max(87_600).nullable(),
  })
  .strict()

export const verticalPageSectionSchema = z
  .object({
    id: stableIdSchema,
    blockKey: verticalBlockKeySchema,
    purpose: z.string().trim().min(5).max(500),
    required: z.boolean(),
    conversionIntent: verticalConversionIntentSchema.nullable(),
  })
  .strict()

export const verticalPageSchema = z
  .object({
    id: stableIdSchema,
    slug: z
      .string()
      .trim()
      .regex(/^(?:\/|\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)$/),
    title: z.string().trim().min(1).max(160),
    order: z.number().int().nonnegative(),
    required: z.boolean(),
    sections: z.array(verticalPageSectionSchema).min(1),
  })
  .strict()

export const verticalConversionIntentRecipeSchema = z
  .object({
    id: stableIdSchema,
    intent: verticalConversionIntentSchema,
    requiredEvidenceIds: unique(stableIdSchema),
    fallbackIntent: verticalConversionIntentSchema.nullable(),
    successOutcome: verticalAnalyticsOutcomeSchema,
    sensitiveData: z.enum(['none', 'contact', 'regulated']),
  })
  .strict()

export const verticalAnalyticsOutcomeRecipeSchema = z
  .object({
    id: stableIdSchema,
    outcome: verticalAnalyticsOutcomeSchema,
    eventName: stableIdSchema,
    northStar: z.boolean(),
  })
  .strict()

export const verticalFreshnessRuleSchema = z
  .object({
    id: stableIdSchema,
    evidenceKind: verticalEvidenceKindSchema,
    maxAgeHours: z.number().int().positive().max(87_600),
    onStale: z.enum([
      'block',
      'hide_volatile_fields',
      'fallback_to_inquiry',
      'require_confirmation',
    ]),
  })
  .strict()

export const verticalLifecycleOverrideSchema = z
  .object({
    id: stableIdSchema,
    lifecycle: verticalLifecycleSchema,
    activatePageIds: unique(stableIdSchema),
    deactivatePageIds: unique(stableIdSchema),
    requiredEvidenceIds: unique(stableIdSchema),
    preferredConversionIntent: verticalConversionIntentSchema.nullable(),
  })
  .strict()

export const verticalPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: z
      .string()
      .trim()
      .regex(/^siteforge\.vertical\.[a-z0-9_.-]+$/),
    version: z.number().int().positive(),
    layer: verticalPackLayerSchema,
    selector: stableIdSchema,
    label: z.string().trim().min(1).max(160),
    applicability: verticalApplicabilitySchema,
    requiredEvidence: z.array(verticalEvidenceRequirementSchema),
    optionalEvidence: z.array(verticalEvidenceRequirementSchema),
    decisionIds: unique(stableIdSchema),
    questionIds: unique(stableIdSchema),
    pages: z.array(verticalPageSchema),
    offeringKinds: unique(verticalOfferingKindSchema),
    conversionIntentRecipes: z.array(verticalConversionIntentRecipeSchema),
    seoSchemaTypes: unique(verticalSeoSchemaTypeSchema),
    policyCodes: unique(verticalPolicyCodeSchema),
    forbiddenClaims: unique(stableIdSchema),
    analyticsOutcomes: z.array(verticalAnalyticsOutcomeRecipeSchema),
    freshnessRules: z.array(verticalFreshnessRuleSchema),
    lifecycleOverrides: z.array(verticalLifecycleOverrideSchema),
    conflictsWith: unique(
      z.string().regex(/^siteforge\.vertical\.[a-z0-9_.-]+$/)
    ),
    exclusiveClaims: unique(stableIdSchema),
  })
  .strict()

export const verticalCompositionRequestSchema = z
  .object({
    registryVersion: z.number().int().positive(),
    scope: verticalScopeSchema,
    sector: verticalSectorSchema,
    transaction: verticalTransactionSchema,
    archetype: stableIdSchema,
    modifiers: unique(stableIdSchema),
    lifecycle: verticalLifecycleSchema,
    confirmedOverride: verticalPackSchema
      .refine(pack => pack.layer === 'confirmed_override', {
        message: 'Confirmed overrides must use the confirmed_override layer',
      })
      .nullable(),
  })
  .strict()

export const verticalPackIdentitySchema = z
  .object({
    key: z.string().regex(/^siteforge\.vertical\.[a-z0-9_.-]+$/),
    version: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    layer: verticalPackLayerSchema,
    selector: stableIdSchema,
  })
  .strict()

export const composedVerticalManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    registryVersion: z.number().int().positive(),
    selection: verticalCompositionRequestSchema.omit({
      confirmedOverride: true,
    }),
    packs: z.array(verticalPackIdentitySchema).min(5),
    requiredEvidence: z.array(verticalEvidenceRequirementSchema),
    optionalEvidence: z.array(verticalEvidenceRequirementSchema),
    decisionIds: unique(stableIdSchema),
    questionIds: unique(stableIdSchema),
    pages: z.array(verticalPageSchema),
    offeringKinds: unique(verticalOfferingKindSchema),
    conversionIntentRecipes: z.array(verticalConversionIntentRecipeSchema),
    seoSchemaTypes: unique(verticalSeoSchemaTypeSchema),
    policyCodes: unique(verticalPolicyCodeSchema),
    forbiddenClaims: unique(stableIdSchema),
    analyticsOutcomes: z.array(verticalAnalyticsOutcomeRecipeSchema),
    freshnessRules: z.array(verticalFreshnessRuleSchema),
    lifecycleOverrides: z.array(verticalLifecycleOverrideSchema),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export type VerticalPackLayer = z.infer<typeof verticalPackLayerSchema>
export type VerticalScope = z.infer<typeof verticalScopeSchema>
export type VerticalSector = z.infer<typeof verticalSectorSchema>
export type VerticalTransaction = z.infer<typeof verticalTransactionSchema>
export type VerticalLifecycle = z.infer<typeof verticalLifecycleSchema>
export type VerticalOfferingKind = z.infer<typeof verticalOfferingKindSchema>
export type VerticalConversionIntent = z.infer<
  typeof verticalConversionIntentSchema
>
export type VerticalPolicyCode = z.infer<typeof verticalPolicyCodeSchema>
export type VerticalSeoSchemaType = z.infer<
  typeof verticalSeoSchemaTypeSchema
>
export type VerticalAnalyticsOutcome = z.infer<
  typeof verticalAnalyticsOutcomeSchema
>
export type VerticalEvidenceKind = z.infer<typeof verticalEvidenceKindSchema>
export type VerticalPack = z.infer<typeof verticalPackSchema>
export type VerticalPackIdentity = z.infer<typeof verticalPackIdentitySchema>
export type VerticalCompositionRequest = z.infer<
  typeof verticalCompositionRequestSchema
>
export type ComposedVerticalManifest = z.infer<
  typeof composedVerticalManifestSchema
>
