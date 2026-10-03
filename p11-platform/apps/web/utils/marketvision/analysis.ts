import { z } from 'zod'

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const number = z.number().finite().nonnegative().nullable()
const time = z.string().refine(v => Number.isFinite(Date.parse(v)))
export const AnalysisQuery = z.object({
  propertyId: id, type: z.enum(['summary', 'comparison', 'trends', 'position']).default('summary'),
  days: z.string().regex(/^(?:[1-9]\d{0,2})$/).transform(Number).refine(v => v <= 366).default(30),
  bedrooms: z.string().regex(/^(?:[0-9]|1[0-9]|20)$/).transform(Number).optional(),
  unitType: z.string().trim().min(1).max(100).optional(),
}).strict().refine(v => v.bedrooms === undefined || v.unitType === undefined, 'Choose one unit filter')
export const AnalysisSnapshot = z.object({
  propertyId: id, propertyName: z.string(), snapshotAt: time, windowStart: time, windowDays: z.number().int().positive(),
  competitors: z.array(z.object({id, name: z.string(), address: z.string().nullable(), amenities: z.unknown(), version: z.number()})),
  units: z.array(z.object({id, competitor_id: id, unit_type: z.string(), bedrooms: number, rent_min: number, rent_max: number, sqft_min: number, sqft_max: number, available_count: number, capture_id: id.nullable(), last_updated_at: time.nullable(), version: z.number()})),
  history: z.array(z.object({id, competitor_unit_id: id, rent_min: number, rent_max: number, available_count: number, recorded_at: time, capture_id: id.nullable(), source: z.string().nullable()})),
  captures: z.array(z.object({id, competitor_id: id, source_type: z.string(), source_url: z.string().nullable(), captured_at: time, effective_at: time.nullable(), content_hash: z.string().nullable(), status: z.string(), fetched: z.boolean()})),
})
export type MarketAnalysisSnapshot = z.infer<typeof AnalysisSnapshot>
type Unit = MarketAnalysisSnapshot['units'][number]
type Observation = MarketAnalysisSnapshot['history'][number]
const known = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0
const round = (v: number) => Math.round(v * 100) / 100
const mean = (v: number[]) => v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : null
const min = (v: number[]) => v.length ? v.reduce((a, b) => Math.min(a, b)) : null
const max = (v: number[]) => v.length ? v.reduce((a, b) => Math.max(a, b)) : null
const latest = (v: Array<string | null>) => v.filter((d): d is string => d !== null).sort((a,b) => Date.parse(b)-Date.parse(a))[0] ?? null
export const ANALYSIS_METHOD = 'Mean of known advertised starting rents per saved floor plan; each plan counts once. Missing values stay unknown. No weighting by available apartments, concessions, lease terms or amenities.'

export function analyzeMarket(snapshot: MarketAnalysisSnapshot, filter: {bedrooms?: number; unitType?: string} = {}) {
  const units = snapshot.units.filter(u => (filter.bedrooms === undefined || u.bedrooms === filter.bedrooms) && (filter.unitType === undefined || u.unit_type === filter.unitType))
  const compById = new Map(snapshot.competitors.map(c => [c.id, c]))
  const unitById = new Map(units.map(u => [u.id, u]))
  const captures = new Map(snapshot.captures.map(c => [c.id, c]))
  const history = snapshot.history.filter(h => unitById.has(h.competitor_unit_id) && Date.parse(h.recorded_at) <= Date.parse(snapshot.snapshotAt)).sort((a,b) => Date.parse(a.recorded_at)-Date.parse(b.recorded_at) || a.id.localeCompare(b.id))
  const byUnit = new Map<string, Observation[]>()
  for (const row of history) {const rows = byUnit.get(row.competitor_unit_id) ?? []; rows.push(row); byUnit.set(row.competitor_unit_id, rows)}
  const citation = (u: Unit, h?: Observation) => {
    const captureId = h ? h.capture_id : u.capture_id
    const c = captureId ? captures.get(captureId) : undefined
    const validCapture = c?.competitor_id === u.competitor_id && c.status === 'captured' ? c : undefined
    return {unitId: u.id, unitType: u.unit_type, competitorId: u.competitor_id, competitorName: compById.get(u.competitor_id)?.name ?? 'Unavailable competitor', historyId: h?.id ?? null,
      recordedAt: h ? h.recorded_at : u.last_updated_at, captureId: validCapture?.id ?? null, sourceType: validCapture?.source_type ?? h?.source ?? 'unlinked',
      sourceUrl: validCapture?.source_url ?? null, capturedAt: validCapture?.captured_at ?? null,
      fetchedAt: validCapture?.fetched ? validCapture.captured_at : null, effectiveAt: validCapture?.effective_at ?? null, contentHash: validCapture?.content_hash ?? null}
  }
  const stats = (rows: Unit[]) => {
    const priced = rows.filter(u => known(u.rent_min))
    return {avg: mean(priced.map(u => u.rent_min!)), min: min(rows.map(u => u.rent_min).filter(known)), max: max(rows.map(u => u.rent_max).filter(known)), pricedPlans: priced.length, totalPlans: rows.length, competitorsSampled: new Set(priced.map(u => u.competitor_id)).size}
  }
  const comparisons = snapshot.competitors.map(c => {
    const rows = units.filter(u => u.competitor_id === c.id)
    return {competitor: {id:c.id,name:c.name,address:c.address}, avgRent: stats(rows).avg,
      avgPricePerSqft: mean(rows.filter(u => known(u.rent_min) && known(u.sqft_min) && u.sqft_min > 0).map(u => u.rent_min! / u.sqft_min!)),
      pricedPlans: stats(rows).pricedPlans, amenities: Array.isArray(c.amenities) ? c.amenities.filter((a): a is string => typeof a === 'string') : [],
      units: rows.map(u => ({id:u.id,unitType:u.unit_type,bedrooms:u.bedrooms,rentMin:u.rent_min,rentMax:u.rent_max,sqftMin:u.sqft_min,sqftMax:u.sqft_max,availableCount:u.available_count,
        pricePerSqft: known(u.rent_min) && known(u.sqft_min) && u.sqft_min > 0 ? round(u.rent_min/u.sqft_min) : null, evidence:citation(u)}))}
  }).sort((a,b) => (a.avgRent ?? Infinity)-(b.avgRent ?? Infinity) || a.competitor.id.localeCompare(b.competitor.id))
  const bedroomCounts = [...new Set(units.map(u => u.bedrooms).filter((b): b is number => b !== null))].sort((a,b) => a-b)
  const position = bedroomCounts.map(bedrooms => {
    const rows = units.filter(u => u.bedrooms === bedrooms), s = stats(rows)
    return {bedrooms,unitType:bedrooms === 0 ? 'Studio' : `${bedrooms}BR`,competitors:s.competitorsSampled,avgRent:s.avg,minRent:s.min,maxRent:s.max,pricedPlans:s.pricedPlans,totalPlans:s.totalPlans,
      rentRange:rows.filter(u => known(u.rent_min)).map(u => ({competitor:compById.get(u.competitor_id)!.name,rent:u.rent_min!,unitId:u.id})), citations:rows.map(u => citation(u))}
  })
  const start = Date.parse(snapshot.windowStart), now = Date.parse(snapshot.snapshotAt)
  const ambiguous = new Set<string>()
  for(const [unitId,rows]of byUnit){for(let i=1;i<rows.length;i++){if(Date.parse(rows[i-1].recorded_at)===Date.parse(rows[i].recorded_at)&&rows[i-1].rent_min!==rows[i].rent_min)ambiguous.add(unitId)}}
  const changes: Array<{competitorId:string;competitorName:string;unitId:string;unitType:string;bedrooms:number|null;previousValue:number;currentValue:number;changeAmount:number;changePercent:number|null;recordedAt:string;citations:ReturnType<typeof citation>[]}> = []
  for (const [unitId, rows] of byUnit) {
    if(ambiguous.has(unitId))continue
    for (let i=1;i<rows.length;i++) {const prev=rows[i-1],curr=rows[i]
      if (Date.parse(curr.recorded_at)<start || !known(prev.rent_min) || !known(curr.rent_min) || prev.rent_min===curr.rent_min) continue
      const u=unitById.get(unitId)!,delta=curr.rent_min-prev.rent_min
      changes.push({competitorId:u.competitor_id,competitorName:compById.get(u.competitor_id)!.name,unitId,unitType:u.unit_type,bedrooms:u.bedrooms,previousValue:prev.rent_min,currentValue:curr.rent_min,changeAmount:delta,changePercent:prev.rent_min>0?round(delta/prev.rent_min*100):null,recordedAt:curr.recorded_at,citations:[citation(u,prev),citation(u,curr)]})
    }
  }
  // A fixed cohort prevents newly added plans and repeated updates from moving the average.
  // An unknown intervening rent disqualifies a plan; never carry a number over a saved unknown.
  const cohort = units.filter(u => {const rows=byUnit.get(u.id)??[];return !ambiguous.has(u.id) && rows.length>0 && Date.parse(rows[0].recorded_at)<start && rows.every(h=>known(h.rent_min))})
  const sampleTimes = [start]
  for(let at=(Math.floor(start/86400000)+1)*86400000;at<now;at+=86400000)sampleTimes.push(at)
  sampleTimes.push(now)
  const cohortIds=new Set(cohort.map(u=>u.id)),lastByUnit=new Map<string,Observation>();let cursor=0
  const trends=cohort.length ? sampleTimes.map(at=>{
    while(cursor<history.length && Date.parse(history[cursor].recorded_at)<=at){const h=history[cursor++];if(cohortIds.has(h.competitor_unit_id))lastByUnit.set(h.competitor_unit_id,h)}
    const rows=cohort.map(u=>lastByUnit.get(u.id)!)
    return {date:new Date(at).toISOString(),avgRent:mean(rows.map(h=>h.rent_min!)),minRent:min(rows.map(h=>h.rent_min!).filter(known)),maxRent:max(rows.map(h=>h.rent_max).filter(known)),dataPoints:rows.length,competitorsSampled:new Set(cohort.map(u=>u.competitor_id)).size}
  }) : []
  const first=trends[0]?.avgRent??null,last=trends.at(-1)?.avgRent??null,matchedCompetitors=new Set(cohort.map(u=>u.competitor_id)).size
  const movementPct=first!==null&&first>0&&last!==null&&matchedCompetitors>=2?round((last-first)/first*100):null
  const movement=movementPct===null?'insufficient_data':movementPct>0?'rising':movementPct<0?'falling':'stable'
  const evidence=units.map(u=>citation(u))
  return {snapshotAt:snapshot.snapshotAt,windowStart:snapshot.windowStart,windowDays:snapshot.windowDays,methodology:ANALYSIS_METHOD,
    limitations:['Saved observations describe advertised prices; actual price-effective dates may be unknown.','History uses console recording time and the current active floor-plan set and bedroom labels. Removed or archived plans are excluded.','Conflicting prices at the same recorded time are excluded from changes and history.','Repeated updates do not increase a plan’s weight. Trend lines carry saved values between records; they do not prove unchanged live prices.'],
    summary:{competitorCount:snapshot.competitors.length,totalUnitsTracked:units.length,pricedPlans:stats(units).pricedPlans,
      avgRentByBedroom:Object.fromEntries(position.map(p=>[`${p.bedrooms}BR`,{min:p.minRent,max:p.maxRent,avg:p.avgRent,pricedPlans:p.pricedPlans,totalPlans:p.totalPlans,competitorsSampled:p.competitors}])),
      recentPriceChanges:changes.filter(c=>Date.parse(c.recordedAt)>=now-7*86400000).length,marketTrend:movement,lastUpdated:latest(evidence.map(c=>c.recordedAt)),
      lastFetchedAt:latest(evidence.map(c=>c.fetchedAt)),knownEffectiveDates:evidence.filter(c=>c.effectiveAt!==null).length,unknownEffectiveDates:evidence.filter(c=>c.effectiveAt===null).length},
    comparisons,position,changes:changes.sort((a,b)=>Date.parse(b.recordedAt)-Date.parse(a.recordedAt)),trends,
    trendCoverage:{matchedPlans:cohort.length,totalPlans:units.length,matchedCompetitors,netChangePct:movementPct,direction:movement,citations:cohort.flatMap(u=>{const rows=byUnit.get(u.id)!;return [citation(u,rows[0]),citation(u,rows.at(-1))]})},
    availableBedrooms:[...new Set(snapshot.units.map(u=>u.bedrooms).filter((b):b is number=>b!==null))].sort((a,b)=>a-b), evidence}
}
export type MarketAnalysis = ReturnType<typeof analyzeMarket>
