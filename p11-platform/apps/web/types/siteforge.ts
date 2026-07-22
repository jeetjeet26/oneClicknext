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
  | 'generating_content'
  | 'preparing_assets'
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
] as const

export const acfBlockTypeSchema = z.enum(ACF_BLOCK_TYPES)
export type ACFBlockType = z.infer<typeof acfBlockTypeSchema>

// Section in a page (canonical: generation, preview, edit, and deploy all
// consume this shape; `acfBlock` is the single source of block identity)
export const pageSectionSchema = z.object({
  id: z.string().optional(), // stable identifier for click-to-edit in dashboard
  type: z.string(), // semantic type like 'hero', 'value_proposition', etc.
  acfBlock: acfBlockTypeSchema,
  content: z.record(z.string(), z.unknown()), // ACF field data structure
  reasoning: z.string(), // Why this section is here (for debugging/refinement)
  order: z.number(),
  label: z.string().optional(), // user-facing label
  variant: z.string().optional(), // library variant key
  cssClasses: z.array(z.string()).optional(),
  purpose: z.string().optional(), // section goal from architecture planning
  fields: z.record(z.string(), z.unknown()).optional(), // structured ACF field hints
  photoRequirement: z.unknown().optional(), // photo needs from architecture planning
})
export type PageSection = z.infer<typeof pageSectionSchema>

// Generated page structure
export const generatedPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  purpose: z.string(), // What this page aims to achieve
  sections: z.array(pageSectionSchema),
  priority: z.string().optional(),
})
export type GeneratedPage = z.infer<typeof generatedPageSchema>

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
  
  wpUrl?: string
  wpAdminUrl?: string
  wpInstanceId?: string
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
export const siteBlueprintSchema = z.object({
  version: z.number(),
  pages: z.array(generatedPageSchema),
  updatedAt: z.string().optional(),
  propertyId: z.string().optional(),
  // Agent outputs (metadata carried alongside the deployable pages)
  brandContext: z.unknown().optional(),
  architecture: z.unknown().optional(),
  designSystem: z.unknown().optional(),
  photoManifest: z.unknown().optional(),
  qualityReport: z.unknown().optional(),
  generationTime: z.number().optional(),
  agentLogs: z
    .array(z.object({ agent: z.string(), action: z.string(), timestamp: z.string() }))
    .optional(),
})
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
export interface GenerateWebsiteRequest {
  propertyId: string
  preferences?: GenerationPreferences
  prompt?: string // conversation-start: user describes desired site; KB-driven
  brandContext?: any // Pre-analyzed brand context from /api/siteforge/analyze - avoids re-running Brand Agent
}

export interface GenerateWebsiteResponse {
  jobId: string
  websiteId: string
  status: 'queued'
  estimatedTimeSeconds: number
}

export interface WebsiteStatusResponse {
  websiteId: string
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
  websiteId: string
  pages?: string[] // If empty, regenerate entire site
  reason?: string
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

// Blueprint patch operations for conversational editing
export type BlueprintPatchOperation =
  | {
      op: 'update_section'
      sectionId: string
      content?: Record<string, unknown>
      variant?: string
      cssClasses?: string[]
      reasoning?: string
    }
  | {
      op: 'add_section'
      pageSlug: string
      afterSectionId?: string
      section: {
        type: string
        acfBlock: ACFBlockType
        content: Record<string, unknown>
        reasoning: string
        label?: string
        variant?: string
      }
    }
  | { op: 'remove_section'; sectionId: string }
  | { op: 'move_section'; sectionId: string; toOrder: number }








