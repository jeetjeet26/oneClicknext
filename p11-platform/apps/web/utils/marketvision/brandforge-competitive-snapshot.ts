import { createAdminClient } from '@/utils/supabase/admin'
import { sha256Hex } from '@/utils/sha256'
import {
  BRAND_FORGE_COMPETITIVE_SNAPSHOT_VERSION,
  competitivePositioningSnapshotSchema,
  type BrandForgeVertical,
  type CompetitivePositioningEvidence,
  type CompetitivePositioningSnapshot,
} from '@/utils/brandforge/contracts'

type CompetitiveSourceRow = {
  competitorId: string
  competitorName: string
  sourceUrl: string | null
  intelligenceId: string
  captureId: string | null
  positioning: string | null
  brandVoice: string | null
  targetAudience: string | null
  messagingThemes: string[]
  observedAt: string | null
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) result[key] = canonicalize(item)
      return result
    }, {})
}

function hashCanonical(value: unknown): string {
  return sha256Hex(JSON.stringify(canonicalize(value)))
}

function normalizedText(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

function deriveMarketGaps(evidence: CompetitivePositioningEvidence[]): string[] {
  if (evidence.length === 0) {
    return ['Competitive positioning evidence is not yet available']
  }

  const corpus = evidence.flatMap(item => [
    item.positioning,
    item.brandVoice,
    ...item.messagingThemes,
  ]).filter((value): value is string => Boolean(value)).join(' ').toLowerCase()

  const candidates = [
    ['specific proof over generic claims', ['proof', 'verified', 'demonstrated']],
    ['clear community belonging without category clichés', ['belong', 'community', 'neighbor']],
    ['distinctive place-led storytelling', ['place', 'local', 'neighborhood']],
  ] as const

  const gaps = candidates
    .filter(([, signals]) => signals.every(signal => !corpus.includes(signal)))
    .map(([gap]) => gap)

  return gaps.length > 0
    ? gaps
    : ['Differentiate through a sharper, property-specific expression of established category themes']
}

function deriveWebsiteExpressionOpportunities(
  evidence: CompetitivePositioningEvidence[],
  marketGaps: string[]
): string[] {
  const competitorNames = evidence.map(item => item.competitorName)
  const comparison = competitorNames.length > 0
    ? `Make the website visibly distinct from ${competitorNames.slice(0, 3).join(', ')}`
    : 'Use property-specific proof and concrete details instead of unsupported category claims'

  return [
    comparison,
    ...marketGaps.map(gap => `Express ${gap} through website hierarchy, copy, and imagery`),
  ]
}

export function buildCompetitivePositioningSnapshot(input: {
  propertyId: string
  vertical: BrandForgeVertical
  generatedAt: string
  rows: CompetitiveSourceRow[]
}): CompetitivePositioningSnapshot {
  const evidence = input.rows.map<CompetitivePositioningEvidence>(row => ({
    competitorId: row.competitorId,
    competitorName: row.competitorName.trim(),
    positioning: normalizedText(row.positioning),
    brandVoice: normalizedText(row.brandVoice),
    targetAudience: normalizedText(row.targetAudience),
    messagingThemes: [...new Set(row.messagingThemes.map(value => value.trim()).filter(Boolean))].sort(),
    source: {
      sourceType: 'competitor_brand_intelligence',
      sourceId: row.intelligenceId,
      captureId: row.captureId,
      sourceUrl: row.sourceUrl,
      observedAt: row.observedAt,
    },
  })).sort((left, right) => left.competitorId.localeCompare(right.competitorId))

  const sourceHash = hashCanonical(evidence)
  const causalHash = hashCanonical({
    algorithm: 'brandforge-competitive-positioning-v1',
    propertyId: input.propertyId,
    vertical: input.vertical,
    sourceHash,
  })
  const marketGaps = deriveMarketGaps(evidence)

  return competitivePositioningSnapshotSchema.parse({
    schemaVersion: BRAND_FORGE_COMPETITIVE_SNAPSHOT_VERSION,
    propertyId: input.propertyId,
    vertical: input.vertical,
    generatedAt: input.generatedAt,
    evidence,
    marketGaps,
    websiteExpressionOpportunities:
      deriveWebsiteExpressionOpportunities(evidence, marketGaps),
    sourceHash,
    causalHash,
  })
}

export async function loadCompetitivePositioningSnapshot(input: {
  propertyId: string
  vertical: BrandForgeVertical
}): Promise<CompetitivePositioningSnapshot> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('competitors')
    .select(`
      id,
      name,
      website_url,
      brand_intel:competitor_brand_intelligence(
        id,
        capture_id,
        positioning_statement,
        brand_voice,
        target_audience,
        key_messaging_themes,
        last_analyzed_at
      )
    `)
    .eq('property_id', input.propertyId)
    .eq('is_active', true)
    .order('name')

  if (error) {
    throw new Error(`Unable to load MarketVision positioning evidence: ${error.message}`)
  }

  const rows: CompetitiveSourceRow[] = (data || []).flatMap(competitor => {
    const intelligence = Array.isArray(competitor.brand_intel)
      ? competitor.brand_intel[0]
      : competitor.brand_intel
    if (!intelligence?.id) return []
    return [{
      competitorId: competitor.id,
      competitorName: competitor.name,
      sourceUrl: competitor.website_url,
      intelligenceId: intelligence.id,
      captureId: intelligence.capture_id,
      positioning: intelligence.positioning_statement,
      brandVoice: intelligence.brand_voice,
      targetAudience: intelligence.target_audience,
      messagingThemes: intelligence.key_messaging_themes || [],
      observedAt: intelligence.last_analyzed_at,
    }]
  })

  return buildCompetitivePositioningSnapshot({
    ...input,
    generatedAt: new Date().toISOString(),
    rows,
  })
}
