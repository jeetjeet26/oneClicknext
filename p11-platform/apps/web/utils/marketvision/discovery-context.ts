import {createHash} from 'node:crypto'
import {createServiceClient} from '@/utils/supabase/admin'
import { BrainError, type GenerationContext } from '@/utils/community-brain/contracts'
import { getCommunityContext, resolveCommunityScope } from '@/utils/community-brain/server'

const query = '"community type" OR "living options" OR "care services" OR "active adult" OR "independent living" OR "assisted living" OR "memory care" OR student OR affordable OR rental OR ownership OR pricing OR amenities OR positioning OR competitors'
const compact = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value) ?? '').slice(0, 2000)
const competitorEvidence = (value: unknown) => /competitor|marketvision/i.test(JSON.stringify(value ?? {}))

/** Only eligible community facts become subject signals; competitor observations cannot describe the subject. */
export function discoveryContext(context: GenerationContext, setup?: {special_features?: unknown; target_audience?: unknown; settings?: unknown}) {
  const property = context.canonical.property
  const signals: Array<{id: string; text: string}> = []
  for (const key of ['property_type', 'propertyType', 'amenities', 'special_features', 'specialFeatures', 'target_audience', 'audience']) {
    if (property[key]) signals.push({id: `property:${key}`, text: `${key}: ${compact(property[key])}`})
  }
  if (setup) {
    const settings = setup.settings as {onboarding?: {transaction?: string}} | undefined
    const transaction = settings?.onboarding?.transaction
    if (transaction && ['rental', 'for_sale', 'care_services'].includes(transaction)) signals.push({id: 'property:onboarding.transaction', text: `transaction_model: ${transaction.replaceAll('_', ' ')}`})
    if (setup.special_features) signals.push({id: 'property:special_features', text: compact(setup.special_features)})
    if (setup.target_audience) signals.push({id: 'property:target_audience', text: compact(setup.target_audience)})
  }
  for (const fact of context.canonical.facts) {
    const payload = fact.payload as Record<string, unknown> | undefined
    if (competitorEvidence(fact) || /restricted_claims|claims_to_avoid/.test(String(fact.key))) continue
    if (payload?.value) signals.push({id: `fact:${fact.id}`, text: `${fact.key}: ${compact(payload.value)}`})
  }
  if (context.canonical.brand?.voice) signals.push({id: `brand:${context.canonical.brand.id}`, text: compact(context.canonical.brand.voice)})
  for (const evidence of context.evidence) {
    if (!evidence.allowedUses.includes('fact') || competitorEvidence(evidence.metadata)) continue
    signals.push({id: `evidence:${evidence.evidenceId}`, text: compact(evidence.content)})
  }
  const rents = context.canonical.floorplans.flatMap(unit => typeof unit.rent_min === 'number' && unit.rent_min > 0 ? [unit.rent_min] : [])
  // Explicit competitor facts are search seeds, never subject features.
  const knownCompetitors = context.canonical.facts.flatMap(fact => {
    if (!/competitor/i.test(String(fact.key))) return []
    const payload = fact.payload as Record<string, unknown> | undefined
    const names = typeof payload?.value === 'string' ? payload.value.split(/\n|;/).map(n => n.trim()).filter(Boolean) : []
    return names.map(n => n.slice(0, 200))
  }).concat(context.evidence.flatMap(e => {
    if (!e.allowedUses.includes('fact') || competitorEvidence(e.metadata)) return []
    return [...e.content.matchAll(/^Known competitor:\s*(.{1,200})$/gmi)].map(m => m[1].trim())
  })).slice(0, 5)
  // Bound the complete signal, including its field label, to the service contract.
  const boundedSignals = signals.slice(0, 30).map(signal => ({...signal, text: signal.text.slice(0, 2000)}))
  return {
    property_id: context.propertyId, context_hash: createHash('sha256').update(JSON.stringify({recipe: 'community-discovery-v1', community: context.contextHash, signals: boundedSignals, knownCompetitors})).digest('hex'),
    property_type: String(property.property_type ?? property.propertyType ?? ''),
    signals: boundedSignals, known_competitors: knownCompetitors,
    known_competitor_source_ids: context.canonical.facts.filter(fact => /competitor/i.test(String(fact.key))).map(fact => `fact:${fact.id}`).slice(0, 5),
    avg_rent: rents.length ? rents.reduce((a,b) => a+b,0)/rents.length : null,
    amenities: Array.isArray(property.amenities) ? property.amenities.filter((a): a is string => typeof a === 'string').slice(0, 100) : [],
    bedrooms: [...new Set(context.canonical.floorplans.flatMap(unit => typeof unit.bedrooms === 'number' ? [unit.bedrooms] : []))],
  }
}

export async function loadDiscoveryContext(actorId: string, propertyId: string) {
  try {
    const scope = await resolveCommunityScope(actorId, propertyId, 'research')
    const context = await getCommunityContext(scope, {propertyId, query})
    // The scope above authorizes this exact property. Only selected profile hints leave this process.
    const setup = await createServiceClient().from('properties').select('special_features,target_audience,settings').eq('id', propertyId).single()
    return {context: discoveryContext(context, setup.data ?? undefined), warnings: setup.error ? ['Additional setup details could not be loaded. Matching uses reviewed community knowledge.'] : [] as string[]}
  } catch (error) {
    if (error instanceof BrainError && [401,403,409].includes(error.status)) throw error
    return {context: null, warnings: ['Community knowledge is temporarily unavailable. This search uses the saved community profile.']}
  }
}
