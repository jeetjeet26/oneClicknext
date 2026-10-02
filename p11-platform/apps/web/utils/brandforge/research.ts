import type { BrandForgeCompetitor } from '@/components/brandforge/BrandForgeCompetitorCard'
type Data = Record<string, unknown>
const record = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0,30) : []
const text = (value: unknown) => typeof value === 'string' ? value.slice(0,2000) : ''
export type ResearchProvider = { discovery: 'not_requested'|'completed'|'unavailable'|'unknown'; intelligence: 'not_requested'|'queued'|'unavailable'|'unknown'; jobId?: string }
export type ResearchAnalysis = {
  requestId: string; capturedAt: string; radiusMiles: number; mode: 'saved'|'refresh'; competitorCount: number; competitorIds: string[];
  competitors: Array<BrandForgeCompetitor & { evidenceStatus: 'current'|'stale'|'unverified'; analyzedAt: string | null; analysisVersion: string | null }>;
  marketGaps: string[]; recommendations: string[]; warnings: string[];
  evidence: { current: number; stale: number; unverified: number; freshnessDays: number; sufficientForHypotheses: boolean }; provider: ResearchProvider;
}
export function buildResearchAnalysis(rows: unknown[], options: { requestId:string; radiusMiles:number; mode:'saved'|'refresh'; provider:ResearchProvider }, now = new Date()): ResearchAnalysis {
  const competitors = rows.map(raw => {
    const c = record(raw), intel = record(Array.isArray(c.brand_intel) ? c.brand_intel[0] : c.brand_intel)
    const analyzedAt = text(intel.last_analyzed_at), age = now.getTime() - Date.parse(analyzedAt)
    const supported = Boolean(text(intel.brand_voice)) && Number(intel.pages_analyzed) > 0 && Number(intel.confidence_score) >= 0.5 && Number.isFinite(age) && age >= -300000
    const evidenceStatus = !supported ? 'unverified' as const : age > 30*86400000 ? 'stale' as const : 'current' as const
    return { id:text(c.id),name:text(c.name),address:text(c.address)||null,websiteUrl:text(c.website_url)||null,phone:text(c.phone)||null,propertyType:text(c.property_type),unitsCount:typeof c.units_count==='number'?c.units_count:null,yearBuilt:typeof c.year_built==='number'?c.year_built:null,amenities:strings(c.amenities),photos:strings(c.photos),lastScrapedAt:text(c.last_scraped_at)||null,brandVoice:text(intel.brand_voice)||'Not analyzed',personality:text(intel.brand_personality)||'Not analyzed',positioning:text(intel.positioning_statement)||'Not analyzed',targetAudience:text(intel.target_audience)||'Not analyzed',usps:strings(intel.unique_selling_points),highlightedAmenities:strings(intel.highlighted_amenities),activeSpecials:strings(intel.active_specials),lifestyleFocus:strings(intel.lifestyle_focus),evidenceStatus,analyzedAt:analyzedAt||null,analysisVersion:text(intel.analysis_version)||null }
  })
  const current = competitors.filter(c=>c.evidenceStatus==='current'), stale=competitors.filter(c=>c.evidenceStatus==='stale').length
  const sufficient = current.length >= 3 && current.length === competitors.length
  const marketGaps:string[]=[]
  if (sufficient) for (const [pattern,theme] of [[/modern|innovat|technology/i,'modern, technology-focused'],[/value|affordab/i,'value-conscious'],[/community|neighbor/i,'community-focused']] as const) {
    if (!current.some(c=>pattern.test(c.brandVoice))) marketGaps.push(`Explore ${theme} positioning: it does not appear in these ${current.length} current competitor records.`)
  }
  const warnings:string[]=[]
  if (!competitors.length) warnings.push('No saved competitor evidence was found. This does not establish that the market has no competitors.')
  else if (!sufficient) warnings.push('There is not enough current, supported brand evidence to suggest market gaps. Review missing or older research first.')
  if (options.provider.discovery==='unavailable') warnings.push('Competitor discovery was unavailable. This report uses saved records.')
  if (options.provider.discovery==='unknown') warnings.push('The discovery response was not confirmed. Saved records may be incomplete; automatic redispatch is disabled.')
  if (options.provider.intelligence==='queued') warnings.push('Brand analysis is queued. Prepare a new snapshot of saved research after that job finishes.')
  if (options.provider.intelligence==='unknown') warnings.push('The brand analysis request was not confirmed. Check its job state before requesting another refresh.')
  if (options.provider.intelligence==='unavailable') warnings.push('New brand analysis could not be started. Saved evidence is shown.')
  return {requestId:options.requestId,capturedAt:now.toISOString(),radiusMiles:options.radiusMiles,mode:options.mode,competitorCount:competitors.length,competitorIds:competitors.map(c=>c.id),competitors,marketGaps,recommendations:sufficient?['These are hypotheses from a limited sample, not verified market-wide findings.','Validate a proposed positioning against client goals and current competitor evidence before adopting it.']:['Gather and review current competitor evidence before choosing a market-based positioning.'],warnings,evidence:{current:current.length,stale,unverified:competitors.length-current.length-stale,freshnessDays:30,sufficientForHypotheses:sufficient},provider:options.provider}
}
