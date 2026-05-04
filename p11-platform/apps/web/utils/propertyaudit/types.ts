/**
 * PropertyAudit Types
 * Shared types for GEO audit functionality
 */

import { z } from 'zod'

// ============================================================================
// Answer Block Schema (Structured output from LLMs)
// ============================================================================

export const AnswerEntitySchema = z.object({
  name: z.string().min(1),
  domain: z.string(), // Can be empty for entities without known domains
  rationale: z.string().min(1),
  position: z.number().int().min(1)
})

export const AnswerCitationSchema = z.object({
  url: z.string().min(1),
  domain: z.string().min(1),
  entity_ref: z.string() // Required by OpenAI strict schema, can be empty
})

export const AnswerBlockSchema = z.object({
  ordered_entities: z.array(AnswerEntitySchema),
  citations: z.array(AnswerCitationSchema),
  answer_summary: z.string(),
  notes: z
    .object({
      flags: z
        .array(
          z.enum([
            'no_sources',
            'possible_hallucination',
            'outdated_info',
            'nap_mismatch',
            'conflicting_prices'
          ])
        )
        .default([])
    })
    .default({ flags: [] })
})

export type AnswerEntity = z.infer<typeof AnswerEntitySchema>
export type AnswerCitation = z.infer<typeof AnswerCitationSchema>
export type AnswerBlock = z.infer<typeof AnswerBlockSchema>
export type AnswerFlag = AnswerBlock['notes']['flags'][number]

// ============================================================================
// Connector Types
// ============================================================================

export const SUPPORTED_SURFACES = [
  'openai',
  'claude',
  'chatgpt',
  'gemini',
  'perplexity',
  'google_ai',
] as const

export type Surface = (typeof SUPPORTED_SURFACES)[number]

export const SELLABLE_V1_SURFACES = [
  'chatgpt',
  'gemini',
  'perplexity',
  'google_ai',
] as const satisfies readonly Surface[]

export const LEGACY_SURFACES = ['openai', 'claude'] as const satisfies readonly Surface[]
export const DEFAULT_AUDIT_SURFACES = [...SELLABLE_V1_SURFACES] as Surface[]

export const SURFACE_LABELS: Record<Surface, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  google_ai: 'Google AI Proxy',
}

export const SURFACE_MEASUREMENT_NOTES: Record<Surface, string> = {
  openai: 'Legacy provider surface kept for backward compatibility.',
  claude: 'Legacy provider surface kept for backward compatibility.',
  chatgpt: 'Grounded API proxy for ChatGPT-style answer measurement.',
  gemini: 'Grounded API proxy for Gemini-style answer measurement.',
  perplexity: 'Natural-answer API capture with citation-aware parsing.',
  google_ai: 'Google-grounded proxy based on Google search results plus answer synthesis.',
}

export function isSupportedSurface(value: string): value is Surface {
  return SUPPORTED_SURFACES.includes(value as Surface)
}

export function isLegacySurface(surface: Surface): surface is (typeof LEGACY_SURFACES)[number] {
  return (LEGACY_SURFACES as readonly string[]).includes(surface)
}

export function supportsStructuredAudit(surface: Surface): boolean {
  return surface === 'openai' || surface === 'claude'
}

export function getDefaultAuditMode(): GeoAuditMode {
  const raw = (process.env.GEO_AUDIT_MODE || 'natural').toLowerCase()
  return raw === 'structured' ? 'structured' : 'natural'
}

export function getSurfaceLabel(surface: Surface | string): string {
  return isSupportedSurface(surface) ? SURFACE_LABELS[surface] : surface
}

export function getSurfaceMeasurementNote(surface: Surface | string): string {
  return isSupportedSurface(surface) ? SURFACE_MEASUREMENT_NOTES[surface] : 'Custom surface measurement.'
}

export function getSurfaceModelName(surface: Surface): string {
  switch (surface) {
    case 'openai':
      return process.env.GEO_OPENAI_MODEL || 'gpt-5.2'
    case 'claude':
      return process.env.GEO_CLAUDE_MODEL || 'claude-sonnet-4-20250514'
    case 'chatgpt':
      return process.env.GEO_CHATGPT_MODEL || process.env.GEO_OPENAI_MODEL || 'gpt-5.2'
    case 'gemini':
      return process.env.GEO_GEMINI_MODEL || 'gemini-2.5-pro'
    case 'perplexity':
      return process.env.GEO_PERPLEXITY_MODEL || 'sonar-pro'
    case 'google_ai':
      return process.env.GEO_GOOGLE_PROXY_MODEL || process.env.GEO_GEMINI_MODEL || 'google-serp-proxy'
  }
}

export type QueryType = 'branded' | 'category' | 'comparison' | 'local' | 'faq' | 'voice_search'

export type RecommendationAccessLevel = 'URLOnly' | 'CMSOrEditor' | 'CodeRequired' | 'ThirdParty'
export type RecommendationOwner = 'seo' | 'content' | 'engineering' | 'partnerships' | 'client'
export type RecommendationStatus = 'todo' | 'planned' | 'in_progress' | 'done'
export type ProviderFailureReason =
  | 'missing_provider_key'
  | 'provider_unavailable'
  | 'search_unavailable'
  | 'analysis_failed'
  | 'timeout'
  | 'partial_success'

export function classifyProviderFailure(message: string | null | undefined): ProviderFailureReason | null {
  if (!message) return null
  const lower = message.toLowerCase()
  if (lower.includes('api_key') || lower.includes('api key') || lower.includes('not set') || lower.includes('missing')) {
    return 'missing_provider_key'
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('abort')) {
    return 'timeout'
  }
  if (lower.includes('serpapi') || lower.includes('search')) {
    return 'search_unavailable'
  }
  if (lower.includes('parse') || lower.includes('json') || lower.includes('analysis')) {
    return 'analysis_failed'
  }
  return 'provider_unavailable'
}

export interface ConnectorContext {
  queryId: string
  queryText: string
  brandName: string
  brandDomains: string[]
  competitors: string[]
  propertyLocation?: {
    city: string
    state: string
    fullAddress: string
    websiteUrl: string
  }
}

export interface ConnectorResult {
  answer: AnswerBlock
  raw: unknown
}

export interface Connector {
  surface: Surface
  invoke(context: ConnectorContext): Promise<ConnectorResult>
}

// ============================================================================
// Natural two-phase (consumer-like response + analyzer extraction)
// ============================================================================

export type GeoAuditMode = 'structured' | 'natural'

/** Web search result from SerpAPI or similar */
export interface WebSearchSource {
  title: string
  url: string
  domain: string
  snippet: string
}

export interface NaturalResponse {
  text: string
  model: string
  tokensUsed: number
  usedWebSearch: boolean
  /** Web search sources used to inform the response */
  searchSources: WebSearchSource[]
  rawResponse: unknown
}

export const NaturalEntitySchema = z.object({
  name: z.string().min(1),
  domain: z.string(), // Can be empty for entities without known domains
  position: z.number().int().min(1),
  prominence: z.string(), // Accept any value (primary, secondary, mentioned, tertiary, etc.)
  mention_count: z.number().int().min(0),
  first_mention_quote: z.string().min(1)
})

export const NaturalCitationSchema = z.object({
  url: z.string().min(1),
  domain: z.string().min(1),
  citation_type: z.enum(['explicit', 'inferred'])
})

export const NaturalBrandAnalysisSchema = z.object({
  mentioned: z.boolean(),
  position: z.number().int().min(1).nullable(),
  location_stated: z.string().nullable(),
  location_correct: z.boolean().nullable(), // Can be null if location unknown
  prominence: z.string().nullable() // Can be null if brand not mentioned
})

export const NaturalAnalysisSchema = z.object({
  ordered_entities: z.array(NaturalEntitySchema).default([]),
  citations: z.array(NaturalCitationSchema).default([]),
  brand_analysis: NaturalBrandAnalysisSchema,
  extraction_confidence: z.number().min(0).max(100)
})

export type NaturalAnalysis = z.infer<typeof NaturalAnalysisSchema>

export const NaturalExtractionEnvelopeSchema = z.object({
  answer_block: AnswerBlockSchema,
  analysis: NaturalAnalysisSchema
})

export type NaturalExtractionEnvelope = z.infer<typeof NaturalExtractionEnvelopeSchema>

export interface NaturalAnalyzeContext {
  naturalResponse: string
  brandName: string
  queryText: string
  expectedCity?: string
  expectedState?: string
  brandDomains: string[]
  competitors: string[]
}

export interface NaturalAnalyzeResult {
  envelope: NaturalExtractionEnvelope
  raw: unknown
}

export interface NaturalConnector {
  surface: Surface
  getNaturalResponse(query: string): Promise<NaturalResponse>
  analyzeResponse(context: NaturalAnalyzeContext): Promise<NaturalAnalyzeResult>
}

// ============================================================================
// Evaluation Types
// ============================================================================

export interface EvaluationContext {
  brandName: string
  brandDomains: string[]
  competitors: string[]
}

export interface EvaluatedAnswer {
  presence: boolean
  llmRank: number | null
  linkRank: number | null
  sov: number | null
  flags: AnswerFlag[]
}

export interface ScoreBreakdown {
  position: number
  link: number
  sov: number
  accuracy: number
}

export interface ScoredAnswer extends EvaluatedAnswer {
  score: number
  breakdown: ScoreBreakdown
}

export interface AggregateScores {
  overallScore: number
  visibilityPct: number
  avgLlmRank: number | null
  avgLinkRank: number | null
  avgSov: number | null
}

// ============================================================================
// Config
// ============================================================================

export interface GeoConfig {
  openaiApiKey: string
  anthropicApiKey: string
  geminiApiKey: string
  perplexityApiKey: string
  openaiModel: string
  claudeModel: string
  geminiModel: string
  perplexityModel: string
  googleProxyModel: string
  temperature: number
  topP: number
  seed: number
  batchSize: number
}

export function getGeoConfig(): GeoConfig {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    geminiApiKey: process.env.GOOGLE_GEMINI_API_KEY || '',
    perplexityApiKey: process.env.PERPLEXITY_API_KEY || '',
    openaiModel: process.env.GEO_OPENAI_MODEL || 'gpt-5.2',
    claudeModel: process.env.GEO_CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    geminiModel: process.env.GEO_GEMINI_MODEL || 'gemini-2.5-pro',
    perplexityModel: process.env.GEO_PERPLEXITY_MODEL || 'sonar-pro',
    googleProxyModel: process.env.GEO_GOOGLE_PROXY_MODEL || process.env.GEO_GEMINI_MODEL || 'google-serp-proxy',
    temperature: parseFloat(process.env.GEO_TEMPERATURE || '0'),
    topP: parseFloat(process.env.GEO_TOP_P || '1'),
    seed: parseInt(process.env.GEO_SEED || '42'),
    batchSize: parseInt(process.env.GEO_RUN_BATCH_SIZE || '40'),
  }
}

