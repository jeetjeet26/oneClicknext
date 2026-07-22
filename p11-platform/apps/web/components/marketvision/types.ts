/**
 * MarketVision 360 Type Definitions
 */

export interface BrandIntelligence {
  id: string
  competitorId: string
  competitorName?: string
  websiteUrl?: string
  
  // Brand Positioning
  brandVoice: string | null
  brandPersonality: string | null
  positioningStatement: string | null
  targetAudience: string | null
  uniqueSellingPoints: string[]
  
  // Offerings & Features
  highlightedAmenities: string[]
  serviceOfferings: string[]
  lifestyleFocus: string[]
  communityEvents: string[]
  
  // Promotions & Specials
  activeSpecials: string[]
  promotionalMessaging: string | null
  urgencyTactics: string[]
  
  // Website Analysis
  websiteTone: string | null
  keyMessagingThemes: string[]
  callToActionPatterns: string[]
  
  // Semantic Analysis
  sentimentScore: number | null
  confidenceScore: number | null
  
  // Metadata
  pagesAnalyzed: number
  lastAnalyzedAt: string | null
  analysisVersion: string | null
}

/**
 * Canonical job states shared across MarketVision surfaces.
 * `partial` is never a stored state — it is derived from a succeeded job
 * with a mix of processed and failed items (see deriveJobResult).
 */
export type CanonicalJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'retrying'
  | 'cancelled'

export type JobResult = 'success' | 'partial' | 'failure' | null

const RAW_TO_CANONICAL_STATUS: Record<string, CanonicalJobStatus> = {
  pending: 'queued',
  queued: 'queued',
  processing: 'running',
  running: 'running',
  completed: 'succeeded',
  succeeded: 'succeeded',
  failed: 'failed',
  retrying: 'retrying',
  cancelled: 'cancelled',
}

export function toCanonicalJobStatus(rawStatus: string | null | undefined): CanonicalJobStatus {
  return RAW_TO_CANONICAL_STATUS[(rawStatus || '').toLowerCase()] ?? 'queued'
}

export function isTerminalJobStatus(status: CanonicalJobStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

/** Derive an explicit result state for terminal jobs, including partial success. */
export function deriveJobResult(
  status: CanonicalJobStatus,
  processedCount: number,
  failedCount: number
): JobResult {
  if (status === 'succeeded') {
    if (failedCount > 0 && processedCount > 0) return 'partial'
    if (failedCount > 0 && processedCount === 0) return 'failure'
    return 'success'
  }
  if (status === 'failed' || status === 'cancelled') return 'failure'
  return null
}

export interface BrandIntelligenceJob {
  jobId: string
  status: CanonicalJobStatus
  rawStatus: string
  result: JobResult
  totalCompetitors: number
  processedCount: number
  failedCount: number
  currentBatch: number
  totalBatches: number
  progressPercent: number
  startedAt: string | null
  completedAt: string | null
  errorMessage: string | null
}

export interface SemanticSearchResult {
  id: string
  competitorId: string
  competitorName: string
  pageUrl: string
  pageType: string
  content: string
  similarity: number
}

export interface Competitor {
  id: string
  propertyId: string
  name: string
  address: string | null
  websiteUrl: string | null
  phone: string | null
  unitsCount: number | null
  yearBuilt: number | null
  amenities: string[]
  isActive: boolean
  lastScrapedAt: string | null
}

// Brand Voice Colors for UI
export const BRAND_VOICE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'luxury': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  'value-focused': { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  'community-oriented': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  'modern/trendy': { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  'family-friendly': { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
  'professional': { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' },
  'boutique': { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  'resort-style': { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
}

// Lifestyle Focus Icons
export const LIFESTYLE_ICONS: Record<string, string> = {
  'pet-friendly': '🐕',
  'work-from-home': '💻',
  'fitness-focused': '💪',
  'social': '🎉',
  'quiet/peaceful': '🧘',
  'eco-friendly': '🌿',
  'urban': '🏙️',
  'family': '👨‍👩‍👧‍👦',
}

// Sentiment color helper
export function getSentimentColor(score: number | null): string {
  if (score === null) return 'text-gray-400'
  if (score >= 0.5) return 'text-green-600'
  if (score >= 0) return 'text-yellow-600'
  return 'text-red-600'
}

// Confidence color helper
export function getConfidenceColor(score: number | null): string {
  if (score === null) return 'text-gray-400'
  if (score >= 0.8) return 'text-green-600'
  if (score >= 0.6) return 'text-yellow-600'
  return 'text-red-600'
}

