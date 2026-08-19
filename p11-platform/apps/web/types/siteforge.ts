// SiteForge Type Definitions
// Created: December 11, 2025
// The blueprint core (blueprint -> pages -> sections) is defined as Zod
// schemas so LLM structured outputs and route payloads validate against the
// exact same contract that preview and deploy consume.

import { z } from 'zod'

export type GenerationStatus = 
  | 'queued'
  | 'analyzing_brand'
  | 'planning_architecture'
  | 'creating_design'
  | 'planning_photos'
  | 'generating_content'
  | 'preparing_assets'
  | 'executing_photos'
  | 'validating_quality'
  | 'ready_for_preview'
  | 'deploying'
  | 'complete'
  | 'deploy_failed'
  | 'failed'

export type BrandSource = 'brandforge' | 'knowledge_base' | 'generated' | 'hybrid'

export type AssetType = 
  | 'logo'
  | 'hero_image'
  | 'amenity_photo'
  | 'lifestyle_photo'
  | 'floorplan_image'
  | 'icon'
  | 'video'
  | 'pdf'

export type AssetSource = 
  | 'uploaded'
  | 'brandforge'
  | 'generated'
  | 'stock'
  | 'property'

// Brand Intelligence extracted from various sources
export interface BrandIntelligence {
  source: BrandSource
  structured: boolean
  confidence: number // 0.0 to 1.0
  data: {
    brandName?: string
    tagline?: string
    positioning?: string
    targetAudience?: string
    personas?: Array<{
      name: string
      age: string
      occupation: string
      lifestyle: string
      priorities: string[]
    }>
    brandVoice?: string
    brandPersonality?: string[]
    
    // Visual identity
    colors?: {
      primary: Array<{ name: string; hex: string; usage: string }>
      secondary: Array<{ name: string; hex: string; usage: string }>
      palette?: string
    }
    typography?: {
      primaryFont: { name: string; usage: string }
      secondaryFont: { name: string; usage: string }
    }
    logo?: {
      url: string
      concept?: string
      style?: string
    }
    
    // Content guidance
    photoStyle?: {
      characteristics: string[]
      examples: string[]
    }
    contentPillars?: string[]
    keyMessages?: string[]
  }
}

// Property context for site generation
export interface PropertyContext {
  id: string
  name: string
  address: {
    street?: string
    city: string
    state: string
    zip?: string
    country?: string
  }
  phone?: string
  email?: string
  socialLinks?: Record<string, string>
  amenities: string[]
  floorplans?: Array<{
    name: string
    bedrooms: number
    bathrooms: number
    sqft: number
    rent?: number
  }>
  photos: Array<{
    url: string
    alt: string
    category?: string
  }>
  policies?: {
    pets?: unknown
    parking?: unknown
  }
  specialFeatures?: string[]
  unitCount?: number
  yearBuilt?: number
}

// Competitive intelligence
export interface CompetitorIntelligence {
  sites: Array<{
    name: string
    url: string
    screenshot?: string
  }>
  commonPatterns: string[]
  contentGaps: string[]
  designTrends: string[]
}

// User preferences for generation
export interface GenerationPreferences {
  style?: 'modern' | 'luxury' | 'cozy' | 'vibrant' | 'professional'
  emphasis?: 'amenities' | 'location' | 'lifestyle' | 'value' | 'community'
  ctaPriority?: 'tours' | 'applications' | 'contact' | 'calls'
  referenceSiteUrl?: string
  contentDensity?: 'minimal' | 'balanced' | 'rich'
  motion?: 'none' | 'subtle' | 'expressive'
  enabledCapabilities?: Array<'crm' | 'tours' | 'chatbot' | 'analytics'>
}

// Full context for site generation
export interface SiteContext {
  brand: BrandIntelligence
  property: PropertyContext
  competitors: CompetitorIntelligence
  documents: Array<{
    id: string
    fileName: string
    fileUrl: string
    type: string
  }>
  preferences?: GenerationPreferences
  userPrompt?: string
  kbContext?: string
}

// ACF Block types from the oneclick-siteforge (Collection) theme
export const ACF_BLOCK_TYPES = [
  'acf/menu',
  'acf/top-slides',
  'acf/text-section',
  'acf/feature-section',
  'acf/image',
  'acf/links',
  'acf/content-grid',
  'acf/form',
  'acf/map',
  'acf/html-section',
  'acf/gallery',
  'acf/accordion-section',
  'acf/plans-availability',
  'acf/poi',
  'acf/testimonials',
  'acf/offering-browser',
  'acf/entity-directory',
  'acf/comparison-table',
  'acf/timeline',
  'acf/document-library',
  'acf/events-directory',
  'acf/governed-component',
] as const

export const acfBlockTypeSchema = z.enum(ACF_BLOCK_TYPES)
export type ACFBlockType = z.infer<typeof acfBlockTypeSchema>

export const SITEFORGE_BLOCK_CAPABILITIES = {
  'acf/menu': { variants: ['standard', 'sticky-cta'] },
  'acf/top-slides': {
    variants: [
      'cinematic',
      'editorial',
      'split',
      'panoramic',
      'immersive',
      'minimal',
    ],
  },
  'acf/text-section': { variants: ['editorial', 'contained', 'lead'] },
  'acf/feature-section': {
    variants: [
      'alternating',
      'bleed',
      'framed',
      'spotlight',
      'collage',
      'compact',
    ],
  },
  'acf/image': { variants: ['full-bleed', 'contained'] },
  'acf/links': { variants: ['inline', 'banner', 'sticky'] },
  'acf/content-grid': {
    variants: [
      'amenity-grid',
      'tabs',
      'editorial',
      'bento',
      'icon-list',
      'carousel',
    ],
  },
  'acf/form': { variants: ['card', 'split', 'minimal'] },
  'acf/map': { variants: ['standard', 'immersive', 'centered'] },
  'acf/html-section': { variants: ['contained', 'full-width'] },
  'acf/gallery': {
    variants: [
      'categorized',
      'masonry',
      'lightbox',
      'filmstrip',
      'mosaic',
      'full-bleed',
    ],
  },
  'acf/accordion-section': { variants: ['bordered', 'minimal'] },
  'acf/plans-availability': { variants: ['cards', 'details', 'preleasing'] },
  'acf/poi': { variants: ['narrative', 'map-list', 'editorial'] },
  'acf/testimonials': { variants: ['cards', 'spotlight', 'carousel'] },
  'acf/offering-browser': { variants: ['cards', 'list', 'availability'] },
  'acf/entity-directory': { variants: ['cards', 'map', 'grouped'] },
  'acf/comparison-table': { variants: ['table', 'cards', 'compact'] },
  'acf/timeline': { variants: ['vertical', 'horizontal', 'milestones'] },
  'acf/document-library': { variants: ['list', 'cards', 'grouped'] },
  'acf/events-directory': { variants: ['cards', 'calendar', 'list'] },
  'acf/governed-component': { variants: ['governed'] },
} as const satisfies Record<
  ACFBlockType,
  { readonly variants: readonly string[] }
>

export function isSiteForgeBlockVariant(
  block: ACFBlockType,
  variant: string
): boolean {
  return (SITEFORGE_BLOCK_CAPABILITIES[block].variants as readonly string[]).includes(
    variant
  )
}

export const siteForgeCssClassSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/,
    'CSS classes must be plain class identifiers'
  )

const sectionPresentationBaseShape = {
  containerMode: z.enum(['contained', 'full-width', 'full-bleed']),
  alignment: z.enum(['left', 'center', 'right', 'stretch']),
  widthPreset: z.enum(['narrow', 'content', 'wide', 'full']),
  spacingPreset: z.enum(['none', 'compact', 'standard', 'spacious']),
  typographyPreset: z.enum(['default', 'editorial', 'display', 'compact']),
  motionPreset: z.enum(['none', 'subtle', 'expressive']),
}

export const sectionPresentationBreakpointOverrideSchema = z
  .object(sectionPresentationBaseShape)
  .partial()
  .strict()
  .refine(value => Object.keys(value).length > 0, {
    message: 'A breakpoint override requires at least one presentation field',
  })

export const sectionPresentationSchema = z
  .object({
    ...sectionPresentationBaseShape,
    breakpointOverrides: z
      .object({
        mobile: sectionPresentationBreakpointOverrideSchema.optional(),
        tablet: sectionPresentationBreakpointOverrideSchema.optional(),
        desktop: sectionPresentationBreakpointOverrideSchema.optional(),
        wide: sectionPresentationBreakpointOverrideSchema.optional(),
      })
      .partial()
      .strict()
      .optional(),
  })
  .partial()
  .strict()
  .refine(value => Object.keys(value).length > 0, {
    message: 'Section presentation requires at least one field',
  })
export type SectionPresentation = z.infer<typeof sectionPresentationSchema>

// Section in a page (canonical: generation, preview, edit, and deploy all
// consume this shape; `acfBlock` is the single source of block identity)
const pageSectionObjectSchema = z.object({
  id: z.string().optional(), // stable identifier for click-to-edit in dashboard
  type: z.string(), // semantic type like 'hero', 'value_proposition', etc.
  acfBlock: acfBlockTypeSchema,
  content: z.record(z.string(), z.unknown()), // ACF field data structure
  reasoning: z.string(), // Why this section is here (for debugging/refinement)
  order: z.number(),
  label: z.string().optional(), // user-facing label
  variant: z.string().trim().min(1).max(120).optional(), // library variant key
  cssClasses: z.array(siteForgeCssClassSchema).max(20).optional(),
  purpose: z.string().optional(), // section goal from architecture planning
  fields: z.record(z.string(), z.unknown()).optional(), // structured ACF field hints
  photoRequirement: z.unknown().optional(), // photo needs from architecture planning
  evidenceIds: z.array(z.string()).optional(), // trusted source records supporting factual copy
  presentation: sectionPresentationSchema.optional(),
})

function addSectionCapabilityIssues(
  section: { acfBlock: ACFBlockType; variant?: string },
  context: z.RefinementCtx
): void {
  if (
    section.variant &&
    !isSiteForgeBlockVariant(section.acfBlock, section.variant)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['variant'],
      message: `Unsupported ${section.acfBlock} variant "${section.variant}"`,
    })
  }
}

export const pageSectionSchema = pageSectionObjectSchema.superRefine(
  addSectionCapabilityIssues
)
export type PageSection = z.infer<typeof pageSectionSchema>

// Generated page structure
export const generatedPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  purpose: z.string(), // What this page aims to achieve
  sections: z.array(pageSectionSchema),
  priority: z.string().optional(),
  seo: z
    .object({
      title: z.string(),
      description: z.string(),
      canonicalPath: z.string(),
      noIndex: z.boolean(),
      structuredData: z.array(z.string()),
    })
    .optional(),
})
export type GeneratedPage = z.infer<typeof generatedPageSchema>

// V3 keeps the deployable page shape compatible with the existing semantic
// editor/runtime. Full JSON-LD objects remain pinned in the confirmed Plan V2
// and are compiled into runtime resources separately.
export const generatedPageV3Schema = generatedPageSchema
export type GeneratedPageV3 = z.infer<typeof generatedPageV3Schema>

const urlOrPathSchema = z.string().min(1).refine(
  value =>
    (value.startsWith('/') && !value.startsWith('//')) ||
    /^https:\/\//i.test(value),
  'Expected an HTTPS URL or safe root-relative path'
)

export const navigationItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  href: urlOrPathSchema,
  parentId: z.string().min(1).optional(),
  external: z.boolean().optional(),
}).strict()

export const siteForgeRedirectPlanSchema = z
  .object({
    sourcePath: z
      .string()
      .regex(/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/?)?$/),
    destination: z
      .string()
      .regex(/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/?)?$/),
    statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]),
    preserveQuery: z.boolean(),
  })
  .strict()
  .refine(redirect => redirect.sourcePath !== redirect.destination, {
    message: 'Redirect source and destination must differ',
  })
export type SiteForgeRedirectPlan = z.infer<typeof siteForgeRedirectPlanSchema>

export const siteConfigurationSchema = z.object({
  design: z.object({
    colors: z.object({
      primary: z.string().min(1),
      secondary: z.string().min(1),
      accent: z.string().min(1),
      background: z.string().min(1),
      text: z.string().min(1),
    }).strict(),
    typography: z.object({
      headingFont: z.string().min(1),
      bodyFont: z.string().min(1),
      headingWeight: z.number().int().min(100).max(900),
    }).strict(),
    spacing: z.object({
      containerMaxWidth: z.string().min(1),
      sectionPadding: z.string().min(1),
    }).strict(),
  }).strict(),
  header: z.object({
    layout: z.enum(['logo-left', 'logo-center', 'split']),
    position: z.enum(['static', 'sticky', 'overlay']),
    announcement: z.object({
      enabled: z.boolean(),
      text: z.string(),
      link: urlOrPathSchema.optional(),
    }).strict(),
    cta: z.object({
      enabled: z.boolean(),
      label: z.string().min(1),
      href: urlOrPathSchema,
    }).strict(),
  }).strict(),
  navigation: z.object({
    style: z.enum(['horizontal', 'mega', 'drawer']),
    items: z.array(navigationItemSchema),
  }).strict(),
  footer: z.object({
    layout: z.enum(['compact', 'columns', 'editorial']),
    showNavigation: z.boolean(),
    showContact: z.boolean(),
    showSocial: z.boolean(),
    tagline: z.string().optional(),
  }).strict(),
  media: z.object({
    logoAssetId: z.string().uuid().optional(),
    logoUrl: urlOrPathSchema.optional(),
    logoAlt: z.string().optional(),
    faviconAssetId: z.string().uuid().optional(),
    faviconUrl: urlOrPathSchema.optional(),
    defaultImageUrl: urlOrPathSchema.optional(),
    imageTreatment: z.enum(['natural', 'rounded', 'editorial', 'full-bleed']),
  }).strict(),
  motion: z.object({
    level: z.enum(['none', 'subtle', 'prominent']),
    reducedMotion: z.enum(['respect', 'disable']),
    reveal: z.enum(['none', 'fade', 'slide', 'scale']),
    durationMs: z.number().int().min(0).max(5000),
    easing: z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']),
  }).strict(),
  behavior: z.object({
    smoothScroll: z.boolean(),
    externalLinksNewTab: z.boolean(),
    backToTop: z.boolean(),
    cookieConsent: z.enum(['disabled', 'informational', 'required']),
  }).strict(),
}).strict()
export type SiteConfiguration = z.infer<typeof siteConfigurationSchema>

// Site navigation structure
export interface SiteNavigation {
  structure: 'primary' | 'mega' | 'hamburger'
  items: Array<{
    label: string
    slug: string
    priority: 'high' | 'medium' | 'low'
  }>
  cta: {
    text: string
    style: 'primary' | 'secondary'
  }
}

// Complete site architecture (LLM-planned)
export interface SiteArchitecture {
  navigation: SiteNavigation
  pages: GeneratedPage[]
  designDecisions: {
    colorStrategy: string
    imageStrategy: string
    contentDensity: 'minimal' | 'balanced' | 'rich'
    conversionOptimization: string[]
  }
}

// Website asset
export interface WebsiteAsset {
  id: string
  websiteId: string
  assetType: AssetType
  source: AssetSource
  fileUrl: string
  fileSize?: number
  mimeType?: string
  wpMediaId?: number
  altText?: string
  caption?: string
  usageContext?: {
    page: string
    section: string
    position: number
  }
  optimized: boolean
  originalUrl?: string
  createdAt: string
}

// Website generation record
export interface PropertyWebsite {
  id: string
  propertyId: string
  orgId: string
  
  wpUrl?: string
  wpAdminUrl?: string
  wpInstanceId?: string
  wordpressCredentialRef?: string
  currentArtifactVersionId?: string
  /** @deprecated Credentials must remain server-side and referenced by ID. */
  wpCredentials?: {
    username: string
    password: string
  }
  
  generationStatus: GenerationStatus
  generationProgress: number
  currentStep?: string
  errorMessage?: string
  
  brandSource?: BrandSource
  brandConfidence?: number
  
  siteArchitecture?: SiteArchitecture
  pagesGenerated?: GeneratedPage[]
  siteBlueprint?: SiteBlueprint
  siteBlueprintVersion?: number
  siteBlueprintUpdatedAt?: string
  assetsManifest?: {
    totalAssets: number
    assetsByType: Record<AssetType, number>
    generatedAssets: number
    uploadedAssets: number
  }
  
  generationStartedAt?: string
  generationCompletedAt?: string
  generationDurationSeconds?: number
  
  pageViews: number
  tourRequests: number
  conversionRate?: number
  
  version: number
  previousVersionId?: string
  
  userPreferences?: GenerationPreferences
  
  createdAt: string
  updatedAt: string
}

// Canonical blueprint: the single deployable artifact for preview/edit/deploy.
// The agentic metadata fields are optional and loosely typed here; the
// orchestrator narrows them (see OrchestratorBlueprint in agents/orchestrator.ts).
export const siteBlueprintV1Schema = z.object({
  version: z.number(),
  pages: z.array(generatedPageSchema),
  runtimeRedirects: z.array(siteForgeRedirectPlanSchema).max(2_000).optional(),
  updatedAt: z.string().optional(),
  propertyId: z.string().optional(),
  propertySnapshot: z.unknown().optional(),
  // Agent outputs (metadata carried alongside the deployable pages)
  brandContext: z.unknown().optional(),
  architecture: z.unknown().optional(),
  designSystem: z.unknown().optional(),
  photoManifest: z.unknown().optional(),
  qualityReport: z.unknown().optional(),
  siteConfiguration: siteConfigurationSchema.optional(),
  generationTime: z.number().optional(),
  agentLogs: z
    .array(z.object({ agent: z.string(), action: z.string(), timestamp: z.string() }))
    .optional(),
})

const blueprintSha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
export const siteBlueprintV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    version: z.number().int().positive(),
    pages: z.array(generatedPageV3Schema).min(1),
    runtimeRedirects: z.array(siteForgeRedirectPlanSchema).max(2_000).optional(),
    updatedAt: z.string().datetime(),
    propertyId: z.string(),
    manifestPins: z
      .object({
        planContentHash: blueprintSha256Schema,
        verticalProfileContentHash: blueprintSha256Schema,
        verticalPackContentHash: blueprintSha256Schema,
        subjectHierarchyContentHash: blueprintSha256Schema,
        offeringCatalogContentHash: blueprintSha256Schema,
        policySetContentHash: blueprintSha256Schema,
        discoveryContentHash: blueprintSha256Schema,
      })
      .strict(),
    propertySnapshot: z.unknown().optional(),
    confirmedPlan: z.unknown(),
    generationEvidence: z.unknown(),
    brandContext: z.unknown().optional(),
    architecture: z.unknown().optional(),
    designSystem: z.unknown().optional(),
    photoManifest: z.unknown().optional(),
    qualityReport: z.unknown().optional(),
    siteConfiguration: siteConfigurationSchema.optional(),
    generationTime: z.number().optional(),
    legal: z.unknown().optional(),
    analytics: z.unknown().optional(),
    wordpressThemeArtifact: z.unknown().optional(),
    topologyDiff: z.unknown().optional(),
    approvedBrief: z.unknown().optional(),
    approvedCreativeDirection: z.unknown().optional(),
    brandSnapshot: z.unknown().optional(),
    onboardingSnapshot: z.unknown().optional(),
    deterministicQualityReport: z.unknown().optional(),
    agentLogs: z
      .array(
        z.object({
          agent: z.string(),
          action: z.string(),
          timestamp: z.string(),
        })
      )
      .optional(),
  })
  .strict()

export const siteBlueprintSchema = z.union([
  siteBlueprintV3Schema,
  siteBlueprintV1Schema,
])
export type SiteBlueprint = z.infer<typeof siteBlueprintSchema>

// LLM-driven editing API
export interface EditBlueprintRequest {
  websiteId: string
  instruction: string
  selected?: {
    pageSlug?: string
    sectionId?: string
  }
}

export interface EditBlueprintResponse {
  websiteId: string
  blueprint: SiteBlueprint
  appliedOperations: unknown[]
  summary?: string
}

// Generation job
export interface SiteForgeJob {
  id: string
  websiteId: string
  jobType: 'full_generation' | 'regenerate_page' | 'update_content' | 'deploy_changes'
  status: 'queued' | 'processing' | 'complete' | 'failed'
  inputParams?: unknown
  outputData?: unknown
  errorDetails?: unknown
  attempts: number
  maxAttempts: number
  startedAt?: string
  completedAt?: string
  createdAt: string
}

// API request/response types
export interface CreateGenerationRequest {
  planId: string
  confirmedRevision: number
  contentHash: string
  idempotencyKey: string
}

/** @deprecated Use CreateGenerationRequest. Generation requires an approved plan identity. */
export type GenerateWebsiteRequest = CreateGenerationRequest

export interface GenerateWebsiteResponse {
  jobId: string
  websiteId: string
  status: 'queued'
  estimatedTimeSeconds: number
}

export interface WebsiteStatusResponse {
  websiteId: string
  jobId?: string
  workflowRunId?: string
  lifecycleStatus?: 'queued' | 'running' | 'succeeded' | 'failed' | 'retrying' | 'cancelled'
  retryAt?: string
  cancelRequested?: boolean
  attemptCount?: number
  maxAttempts?: number
  status: GenerationStatus
  progress: number
  currentStep?: string
  errorMessage?: string
  brandReadiness?: {
    degraded: boolean
    source: string | null
    confidence: number | null
    blockers: string[]
  }
  deploymentReadiness?: {
    ready: boolean
    mode: 'cloudways' | 'existing_wordpress' | 'unconfigured'
    blockers: string[]
  }
  siteArchitecture?: SiteArchitecture
  wpUrl?: string
  wpAdminUrl?: string
  deploymentDiagnostics?: {
    workflow: 'siteforge_wordpress_deploy'
    status: 'success' | 'failed'
    provider: 'cloudways' | 'existing_wordpress' | 'local_simulation'
    startedAt: string
    completedAt: string
    pagesAttempted: number
    assetsAttempted: number
    verification: {
      enabled: true
      status: 'passed' | 'failed'
      message?: string
    }
    target?: {
      url: string
      adminUrl: string
      instanceId: string
    }
    deploySource: {
      field: 'blueprint' | 'pages_generated'
      blueprintVersion: number | null
      blueprintUpdatedAt: string | null
    }
    error?: {
      message: string
      category: 'verification' | 'configuration' | 'provisioning' | 'unknown'
    }
  }
}

export interface RegenerateRequest {
  planId: string
  confirmedRevision: number
  contentHash: string
  idempotencyKey: string
}

export interface RefineRequest {
  websiteId: string
  refinements: {
    tone?: 'more professional' | 'more casual' | 'more luxury'
    emphasis?: 'more amenities' | 'more location' | 'more value'
    cta?: 'stronger' | 'softer'
  }
}

// === AGENTIC SYSTEM TYPES (Added December 16, 2025) ===

// Versioned semantic operations are shared by LLM output, P11 preview, and
// WordPress publication. Partial objects are intentional update payloads.
const semanticOperationBase = { version: z.literal(2), reasoning: z.string().optional() }
const sectionInputSchema = pageSectionObjectSchema
  .omit({ id: true, order: true })
  .superRefine(addSectionCapabilityIssues)
const designUpdateSchema = z.object({
  colors: siteConfigurationSchema.shape.design.shape.colors.partial().optional(),
  typography: siteConfigurationSchema.shape.design.shape.typography.partial().optional(),
  spacing: siteConfigurationSchema.shape.design.shape.spacing.partial().optional(),
}).strict().refine(value => Object.keys(value).length > 0, {
  message: 'design.update requires at least one field',
})
const headerUpdateSchema = z.object({
  layout: siteConfigurationSchema.shape.header.shape.layout.optional(),
  position: siteConfigurationSchema.shape.header.shape.position.optional(),
  announcement: siteConfigurationSchema.shape.header.shape.announcement.partial().optional(),
  cta: siteConfigurationSchema.shape.header.shape.cta.partial().optional(),
}).strict().refine(value => Object.keys(value).length > 0, {
  message: 'header.update requires at least one field',
})
const pageUpdateSchema = z.object({
  title: generatedPageSchema.shape.title.optional(),
  purpose: generatedPageSchema.shape.purpose.optional(),
  priority: generatedPageSchema.shape.priority,
  seo: generatedPageSchema.shape.seo.unwrap().partial().optional(),
}).strict().refine(value => Object.keys(value).length > 0, {
  message: 'page.update requires at least one field',
})
const sectionPresentationUpdateSchema = z
  .object({
    containerMode: sectionPresentationBaseShape.containerMode.optional(),
    alignment: sectionPresentationBaseShape.alignment.optional(),
    widthPreset: sectionPresentationBaseShape.widthPreset.optional(),
    spacingPreset: sectionPresentationBaseShape.spacingPreset.optional(),
    typographyPreset: sectionPresentationBaseShape.typographyPreset.optional(),
    motionPreset: sectionPresentationBaseShape.motionPreset.optional(),
    breakpointOverrides: z
      .object({
        mobile: sectionPresentationBreakpointOverrideSchema.optional(),
        tablet: sectionPresentationBreakpointOverrideSchema.optional(),
        desktop: sectionPresentationBreakpointOverrideSchema.optional(),
        wide: sectionPresentationBreakpointOverrideSchema.optional(),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict()
const sectionUpdateSchema = z.object({
  type: z.string().optional(),
  acfBlock: acfBlockTypeSchema.optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  label: z.string().optional(),
  variant: z.string().trim().min(1).max(120).optional(),
  cssClasses: z.array(siteForgeCssClassSchema).max(20).optional(),
  purpose: z.string().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  evidenceIds: z.array(z.string()).optional(),
  presentation: sectionPresentationUpdateSchema.optional(),
}).strict().refine(value => Object.keys(value).length > 0, {
  message: 'section.update requires at least one field',
})

function requireUpdate<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  operation: string
) {
  return schema.refine(value => Object.keys(value).length > 0, {
    message: `${operation} requires at least one field`,
  })
}

export const semanticBlueprintPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({
    ...semanticOperationBase,
    op: z.literal('page.upsert'),
    page: generatedPageSchema,
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('page.remove'),
    pageSlug: z.string().min(1),
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('page.update'),
    pageSlug: z.string().min(1),
    value: pageUpdateSchema,
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('page.move'),
    pageSlug: z.string().min(1),
    toOrder: z.number().int().min(1),
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('redirect.upsert'),
    redirect: siteForgeRedirectPlanSchema,
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('section.upsert'),
    pageSlug: z.string().min(1),
    sectionId: z.string().min(1).optional(),
    afterSectionId: z.string().min(1).optional(),
    section: sectionInputSchema,
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('section.update'),
    sectionId: z.string().min(1),
    value: sectionUpdateSchema,
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('section.remove'),
    sectionId: z.string().min(1),
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('section.move'),
    sectionId: z.string().min(1),
    pageSlug: z.string().min(1).optional(),
    toOrder: z.number().int().min(1),
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('design.update'),
    value: designUpdateSchema,
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('header.update'),
    value: headerUpdateSchema,
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('navigation.update'),
    value: requireUpdate(
      siteConfigurationSchema.shape.navigation.partial(),
      'navigation.update'
    ),
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('footer.update'),
    value: requireUpdate(
      siteConfigurationSchema.shape.footer.partial(),
      'footer.update'
    ),
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('media.update'),
    value: requireUpdate(
      siteConfigurationSchema.shape.media.partial(),
      'media.update'
    ),
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('motion.update'),
    value: requireUpdate(
      siteConfigurationSchema.shape.motion.partial(),
      'motion.update'
    ),
  }).strict(),
  z.object({
    ...semanticOperationBase,
    op: z.literal('behavior.update'),
    value: requireUpdate(
      siteConfigurationSchema.shape.behavior.partial(),
      'behavior.update'
    ),
  }).strict(),
])

const legacyBlueprintPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('update_section'),
    sectionId: z.string().min(1),
    content: z.record(z.string(), z.unknown()).optional(),
    variant: z.string().trim().min(1).max(120).optional(),
    cssClasses: z.array(siteForgeCssClassSchema).max(20).optional(),
    reasoning: z.string().optional(),
  }).strict().refine(
    value =>
      value.content !== undefined ||
      value.variant !== undefined ||
      value.cssClasses !== undefined ||
      value.reasoning !== undefined,
    { message: 'update_section requires at least one field' }
  ),
  z.object({
    op: z.literal('add_section'),
    pageSlug: z.string().min(1),
    afterSectionId: z.string().min(1).optional(),
    section: sectionInputSchema,
  }).strict(),
  z.object({ op: z.literal('remove_section'), sectionId: z.string().min(1) }).strict(),
  z.object({
    op: z.literal('move_section'),
    sectionId: z.string().min(1),
    toOrder: z.number().int().min(1),
  }).strict(),
])

export const blueprintPatchOperationSchema = z.union([
  semanticBlueprintPatchOperationSchema,
  legacyBlueprintPatchOperationSchema,
])
export const blueprintPatchOperationsSchema = z.array(blueprintPatchOperationSchema).min(1)
export type SemanticBlueprintPatchOperation = z.infer<typeof semanticBlueprintPatchOperationSchema>
export type BlueprintPatchOperation = z.infer<typeof blueprintPatchOperationSchema>








