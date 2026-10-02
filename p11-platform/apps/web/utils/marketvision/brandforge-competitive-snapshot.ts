import { BrandClaim } from './brand-evidence-contracts'
import { z } from 'zod'
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
  reviewedClaims: z.infer<typeof BrandClaim>[]
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
    .map(([gap]) => `Candidate idea within the reviewed source selection: ${gap}; validate with the client`)

  return gaps.length > 0
    ? gaps
    : ['Candidate idea: explore property-specific expression; this limited source selection cannot establish a market gap']
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
  activeCompetitors?: number
}): CompetitivePositioningSnapshot {
  const evidence = input.rows.map<CompetitivePositioningEvidence>(row => ({
    competitorId: row.competitorId,
    competitorName: row.competitorName.trim(),
    positioning: normalizedText(row.positioning),
    brandVoice: normalizedText(row.brandVoice),
    targetAudience: normalizedText(row.targetAudience),
    messagingThemes: [...new Set(row.messagingThemes.map(value => value.trim()).filter(Boolean))].sort(),
    source: {
      sourceType: 'competitor_brand_review',
      reviewedClaims: row.reviewedClaims,
      sourceId: row.intelligenceId,
      captureId: row.captureId,
      sourceUrl: row.sourceUrl,
      observedAt: row.observedAt,
    },
  })).sort((left, right) => left.competitorId.localeCompare(right.competitorId))

  const sourceHash = hashCanonical({evidence,activeCompetitors:input.activeCompetitors??evidence.length})
  const causalHash = hashCanonical({
    algorithm: 'brandforge-reviewed-competitive-positioning-v2',
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
    coverage: {activeCompetitors: input.activeCompetitors ?? evidence.length, reviewedCompetitors:evidence.length, limitations:'Only current, operator-reviewed source quotations are included. Website claims and interpretations are not independently verified. Missing evidence does not establish a market gap; observed promotions may no longer be active.'},
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
  const supabase=createAdminClient() as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>}
  const {data,error}=await supabase.rpc('read_marketvision_brand_context',{p_property_id:input.propertyId})
  if(error)throw new Error('The complete reviewed MarketVision evidence could not be loaded.')
  const parsed=z.object({propertyId:z.string(),activeCompetitors:z.number().int().nonnegative(),evidence:z.array(z.object({competitor_id:z.string(),competitor_name:z.string(),review_id:z.string(),request_id:z.string(),capture_id:z.string(),source_url:z.string(),observed_at:z.string(),claims:z.array(BrandClaim.extend({sourceIndex:z.number().int()}))}))}).safeParse(data)
  if(!parsed.success||parsed.data.propertyId!==input.propertyId)throw new Error('The complete reviewed MarketVision evidence could not be confirmed.')
  const rows:CompetitiveSourceRow[]=parsed.data.evidence.map(row=>{
    const text=(category:string)=>row.claims.filter(c=>c.category===category).map(c=>c.statement).join(' ')||null
    return {competitorId:row.competitor_id,competitorName:row.competitor_name,intelligenceId:row.review_id,captureId:row.capture_id,sourceUrl:row.source_url,observedAt:new Date(row.observed_at).toISOString(),positioning:text('positioning'),brandVoice:text('voice'),targetAudience:text('audience'),messagingThemes:row.claims.filter(c=>c.category==='messaging').map(c=>c.statement),reviewedClaims:row.claims.map(claim=>({category:claim.category,kind:claim.kind,statement:claim.statement,quote:claim.quote}))}
  })
  return buildCompetitivePositioningSnapshot({...input,generatedAt:new Date().toISOString(),rows,activeCompetitors:parsed.data.activeCompetitors})
}
