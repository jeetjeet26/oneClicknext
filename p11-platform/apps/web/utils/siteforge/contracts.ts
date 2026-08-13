import { z } from 'zod'
import {
  ACF_BLOCK_TYPES,
  acfBlockTypeSchema,
  siteBlueprintSchema,
} from '@/types/siteforge'
import {
  brandForgeContractV1Schema,
  brandOriginSchema,
} from '@/utils/brandforge/contracts'

export const SITEFORGE_PLAN_STATUSES = [
  'draft',
  'ready_for_review',
  'confirmed',
  'consumed',
  'superseded',
  'denied',
] as const

export const SITEFORGE_JOB_STATUSES = [
  'queued',
  'running',
  'retrying',
  'succeeded',
  'failed',
  'cancelled',
] as const

export const SITEFORGE_GENERATION_STAGES = [
  'queued',
  'assembling_context',
  'analyzing_brand',
  'planning_architecture',
  'creating_design',
  'planning_photos',
  'generating_content',
  'executing_photos',
  'validating_quality',
  'publishing_artifact',
  'ready_for_preview',
  'failed',
  'cancelled',
] as const

export const siteForgePlanStatusSchema = z.enum(SITEFORGE_PLAN_STATUSES)
export const siteForgeJobStatusSchema = z.enum(SITEFORGE_JOB_STATUSES)
export const siteForgeGenerationStageSchema = z.enum(SITEFORGE_GENERATION_STAGES)

export const generationPreferencesSchema = z.object({
  style: z.enum(['modern', 'luxury', 'cozy', 'vibrant', 'professional']).optional(),
  emphasis: z.enum(['amenities', 'location', 'lifestyle', 'value', 'community']).optional(),
  ctaPriority: z.enum(['tours', 'applications', 'contact', 'calls']).optional(),
  referenceSiteUrl: z.string().url().max(2_048).optional(),
  contentDensity: z.enum(['minimal', 'balanced', 'rich']).optional(),
  motion: z.enum(['none', 'subtle', 'expressive']).default('subtle'),
  enabledCapabilities: z.array(z.enum([
    'crm',
    'tours',
    'chatbot',
    'analytics',
  ])).default([]),
})

export const siteForgeEvidenceSchema = z.object({
  id: z.string().min(1),
  sourceType: z.enum([
    'property',
    'community_profile',
    'brandforge',
    'knowledge_base',
    'document',
    'photo',
    'property_unit',
    'competitor',
    'operator',
  ]),
  sourceId: z.string().min(1).nullable(),
  label: z.string().min(1).max(240),
  capturedAt: z.string().datetime(),
  sourceUpdatedAt: z.string().datetime().nullable().optional(),
  confidence: z.number().min(0).max(1),
  retrievalStatus: z.enum(['available', 'no_evidence', 'retrieval_failed']),
})

export const siteForgeReadinessIssueSchema = z.object({
  code: z.string().min(1).max(120),
  severity: z.enum(['warning', 'blocker']),
  category: z.enum([
    'property',
    'brand',
    'knowledge',
    'inventory',
    'assets',
    'conversion',
    'wordpress',
    'legal',
    'accessibility',
    'seo',
    'analytics',
    'quality',
  ]),
  message: z.string().min(1).max(1_000),
  evidenceIds: z.array(z.string()).default([]),
  waivedAt: z.string().datetime().nullable().optional(),
  waivedBy: z.string().uuid().nullable().optional(),
  waiverReason: z.string().min(1).max(2_000).nullable().optional(),
})

export const siteForgeReadinessReportSchema = z.object({
  ready: z.boolean(),
  evaluatedAt: z.string().datetime(),
  policyVersion: z.string().min(1),
  issues: z.array(siteForgeReadinessIssueSchema),
})

export const siteForgePlanSectionSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(160),
  purpose: z.string().min(1).max(1_000),
  block: acfBlockTypeSchema,
  variant: z.string().min(1).max(120).optional(),
  required: z.boolean().default(true),
  factsRequired: z.array(z.string().max(240)).default([]),
  evidenceIds: z.array(z.string()).default([]),
})

export const siteForgePlanPageSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1).max(160),
  purpose: z.string().min(1).max(1_000),
  navLabel: z.string().min(1).max(80),
  sections: z.array(siteForgePlanSectionSchema).min(1),
})

export const siteForgeConversionStrategySchema = z.object({
  primaryAction: z.enum(['tours', 'applications', 'contact', 'calls']),
  secondaryAction: z.enum(['tours', 'applications', 'contact', 'calls']).nullable(),
  leadDestination: z.enum(['p11_lumaleasing', 'csv_export', 'unconfigured']),
  tourDestination: z.enum(['p11_lumaleasing', 'external_url', 'unconfigured']),
  requiredForms: z.array(z.enum(['register', 'contact', 'tour'])).min(1),
})

export const siteForgeFloorPlanStrategySchema = z.object({
  source: z.enum(['property_units', 'manual', 'csv', 'unconfigured']),
  display: z.enum(['cards', 'interactive', 'list']),
  showPricing: z.boolean(),
  showAvailability: z.boolean(),
  freshnessHours: z.number().int().positive().max(8_760).default(168),
})

export const siteForgeSiteTypeSchema = z.enum([
  'standard',
  'lease-up',
  'student',
  'senior',
  'portfolio-landing',
])

export const siteForgePlanSchema = z.object({
  schemaVersion: z.literal(1),
  siteType: siteForgeSiteTypeSchema.default('standard'),
  propertyId: z.guid(),
  onboardingSnapshot: z.object({
    // z.guid() (not strict RFC-version uuid) to match propertyId above:
    // seeded rows use fixed ids whose version nibble is not a real v4.
    id: z.guid(),
    contentHash: z.string().length(64),
    enabledCapabilities: z.array(z.enum([
      'crm',
      'tours',
      'chatbot',
      'analytics',
    ])).default([]),
  }).optional(),
  brandSnapshot: z.object({
    assetId: z.guid(),
    contractVersion: z.literal('1.0'),
    contractHash: z.string().length(64),
    origin: brandOriginSchema,
    contract: brandForgeContractV1Schema,
  }).optional(),
  enabledCapabilities: z.array(z.enum([
    'crm',
    'tours',
    'chatbot',
    'analytics',
  ])).default([]),
  name: z.string().min(1).max(200),
  summary: z.string().min(1).max(4_000),
  preferences: generationPreferencesSchema,
  brandDirection: z.object({
    positioning: z.string().min(1).max(2_000),
    voice: z.string().min(1).max(1_000),
    visualDirection: z.string().min(1).max(2_000),
    mustInclude: z.array(z.string().max(500)).default([]),
    mustAvoid: z.array(z.string().max(500)).default([]),
  }),
  audiences: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        contentNeeds: z.array(z.string().min(1).max(500)).min(1),
      })
    )
    .default([]),
  pages: z.array(siteForgePlanPageSchema).min(1),
  conversionStrategy: siteForgeConversionStrategySchema,
  floorPlanStrategy: siteForgeFloorPlanStrategySchema,
  seoStrategy: z.object({
    localSearchFocus: z.array(z.string().max(240)).default([]),
    structuredData: z.array(z.enum(['Organization', 'ApartmentComplex', 'BreadcrumbList', 'FAQPage'])),
  }),
  analyticsStrategy: z.object({
    enabled: z.boolean(),
    consentMode: z.enum(['required', 'not_required', 'unconfigured']),
    events: z.array(
      z.enum([
        'page_view',
        'cta_click',
        'floorplan_view',
        'availability_click',
        'lead_start',
        'lead_submit',
        'tour_start',
        'tour_booked',
      ])
    ),
  }),
  accessibilityRequirements: z.array(z.string().min(1).max(500)).default([]),
  legalRequirements: z.array(z.string().min(1).max(500)).default([]),
  knownFacts: z.array(
    z.object({
      claim: z.string().min(1).max(1_000),
      evidenceIds: z.array(z.string()).min(1),
    })
  ),
  recommendations: z.array(z.string().min(1).max(1_000)).default([]),
  unresolvedQuestions: z.array(z.string().min(1).max(1_000)).default([]),
  evidence: z.array(siteForgeEvidenceSchema),
})

export const siteForgePlanVersionSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  revision: z.number().int().positive(),
  status: siteForgePlanStatusSchema,
  contextSnapshotId: z.string().uuid().nullable(),
  onboardingSnapshotId: z.string().uuid().nullable(),
  onboardingSnapshotHash: z.string().length(64).nullable(),
  brandAssetId: z.string().uuid().nullable(),
  brandContractVersion: z.string().nullable(),
  brandContractHash: z.string().length(64).nullable(),
  plan: siteForgePlanSchema,
  readiness: siteForgeReadinessReportSchema,
  contentHash: z.string().min(32).max(128),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
})

export const confirmedSiteForgePlanSchema = siteForgePlanVersionSchema.extend({
  status: z.literal('confirmed'),
  confirmedBy: z.string().uuid(),
  confirmedAt: z.string().datetime(),
})

export const siteForgeArtifactSchema = z.object({
  id: z.string().uuid(),
  websiteId: z.string().uuid(),
  propertyId: z.guid(),
  orgId: z.string().uuid(),
  version: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  contentHash: z.string().min(32).max(128),
  parentVersionId: z.string().uuid().nullable(),
  changeType: z.enum(['generation', 'edit', 'rollback', 'import']),
  sourcePlanVersionId: z.string().uuid().nullable(),
  sharedJobId: z.string().uuid().nullable(),
  blueprint: siteBlueprintSchema,
  readiness: siteForgeReadinessReportSchema,
  createdAt: z.string().datetime(),
})

export const createGenerationRequestSchema = z.object({
  websiteId: z.string().uuid(),
  planId: z.string().uuid(),
  confirmedRevision: z.number().int().positive(),
  contentHash: z.string().min(32).max(128),
  idempotencyKey: z.string().min(8).max(200),
})

const generationHashSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const siteForgeGenerationAssetEvidenceSchema = z.object({
  id: z.string().uuid(),
  role: z.string().min(1),
  fileUrl: z.string().url(),
  contentHash: generationHashSchema,
  rightsStatus: z.enum(['owned', 'licensed', 'generated']),
  rightsEvidenceHash: generationHashSchema,
  approvalStatus: z.literal('approved'),
  expiresAt: z.string().datetime().nullable(),
})

export const siteForgeGenerationEvidenceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.string().datetime(),
  websiteId: z.string().uuid(),
  propertyId: z.guid(),
  orgId: z.guid(),
  plan: z.object({
    id: z.string().uuid(),
    versionId: z.string().uuid(),
    revision: z.number().int().positive(),
    contentHash: generationHashSchema,
  }),
  brief: z.object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    contentHash: generationHashSchema,
  }),
  creativeDirection: z.object({
    setId: z.string().uuid(),
    setVersion: z.number().int().positive(),
    setContentHash: generationHashSchema,
    directionId: z.string().uuid(),
    directionContentHash: generationHashSchema,
  }),
  onboarding: z.object({
    id: z.string().uuid(),
    contentHash: generationHashSchema,
  }),
  brand: z.object({
    assetId: z.string().uuid(),
    contractVersion: z.literal('1.0'),
    contractHash: generationHashSchema,
  }),
  assetManifest: z.object({
    assets: z.array(siteForgeGenerationAssetEvidenceSchema).min(1),
    contentHash: generationHashSchema,
  }),
  inventory: z.object({
    required: z.boolean(),
    rowCount: z.number().int().nonnegative(),
    contentHash: generationHashSchema,
    latestSourceUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  contentHash: generationHashSchema,
})

export const siteForgeJobStatusResponseSchema = z.object({
  jobId: z.string().uuid(),
  websiteId: z.string().uuid().nullable(),
  lifecycleStatus: siteForgeJobStatusSchema,
  stage: siteForgeGenerationStageSchema,
  progress: z.number().int().min(0).max(100),
  currentStep: z.string().min(1).max(500),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().nonnegative(),
  retryAt: z.string().datetime().nullable(),
  cancelRequested: z.boolean(),
  heartbeatAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
})

export type SiteForgePlan = z.infer<typeof siteForgePlanSchema>
export type SiteForgePlanVersion = z.infer<typeof siteForgePlanVersionSchema>
export type ConfirmedSiteForgePlan = z.infer<typeof confirmedSiteForgePlanSchema>
export type SiteForgeReadinessReport = z.infer<typeof siteForgeReadinessReportSchema>
export type SiteForgeArtifact = z.infer<typeof siteForgeArtifactSchema>
export type CreateGenerationRequest = z.infer<typeof createGenerationRequestSchema>
export type SiteForgeGenerationEvidenceSnapshot = z.infer<
  typeof siteForgeGenerationEvidenceSnapshotSchema
>
export type SiteForgeJobStatusResponse = z.infer<typeof siteForgeJobStatusResponseSchema>

export { ACF_BLOCK_TYPES }
