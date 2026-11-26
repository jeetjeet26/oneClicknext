import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'
import { readMarketingFacts } from '@/utils/analytics/read-marketing-facts'
import { buildBiReport, type BiFact } from '@/utils/analytics/report-data'
import { reportingRows } from '@/utils/analytics/report-quality'
import { communityModel } from '@/utils/community-model'
import { getCommunityContext, resolveCommunityScope, requireCurrentScope } from '@/utils/community-brain/server'
import { researchWorkspace } from '@/utils/marketvision/research-store'
import { readPortfolio } from './portfolio'
import { intelligenceActor, readDocuments, saveDocument, IntelligenceError } from './store'
import { recommendationSchema } from './contracts'
import { recommendationEvidence, type RecommendationEvidence } from './recommendation-contracts'
import { generateRecommendationAnalysis } from './recommendation-model'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const json = (value: unknown) => JSON.parse(JSON.stringify(value))
function analysisFailure(stage: string, error: unknown) {
  // Keep provider messages, source values and URLs out of logs and client errors.
  console.error('AI recommendation analysis failed', { stage, type: error instanceof Error ? error.name : 'Error',
    ...(error instanceof z.ZodError ? { fields: error.issues.slice(0, 10).map(issue => issue.path.join('.')) } : {}),
  })
  return new IntelligenceError('AI recommendations could not be verified from the saved evidence. Please retry the analysis.', 503)
}

export async function recommendationContext(actor: string, propertyId: string, start: string, end: string) {
  const scope = await resolveCommunityScope(actor, propertyId, 'research')
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1
  const priorStart = new Date(Date.parse(start) - days * 86400000).toISOString().slice(0, 10)
  const priorEnd = new Date(Date.parse(start) - 86400000).toISOString().slice(0, 10)
  const [portfolio, current, previous, knowledge, research] = await Promise.all([
    readPortfolio(start, end, false, propertyId),
    readMarketingFacts(createServiceClient(), { propertyId, startDate: start, endDate: end }),
    readMarketingFacts(createServiceClient(), { propertyId, startDate: priorStart, endDate: priorEnd }),
    getCommunityContext(scope, { propertyId, query: '' }),
    researchWorkspace(propertyId),
  ])
  const property = portfolio.properties.find(item => item.score.id === propertyId)
  if (!property || portfolio.properties.length !== 1) throw new IntelligenceError('The selected community could not be confirmed.', 403)
  const makeReport = (rows: BiFact[], earlier: BiFact[]) => buildBiReport({
    version: 'bi-v1', propertyId, propertyName: property.score.name,
    filters: { startDate: start, endDate: end, compare: true, channel: null, account: null },
    currentRows: rows, previousRows: earlier, previousPeriod: { start: priorStart, end: priorEnd },
  })
  const normalizedCurrent = reportingRows(current), normalizedPrevious = reportingRows(previous)
  const report = makeReport(normalizedCurrent, normalizedPrevious)
  // A separate prior-period report preserves per-account/campaign baselines, including
  // campaigns that have stopped running. Never compare campaign names alone.
  const prior = makeReport(normalizedPrevious, [])
  const observedAt = new Date().toISOString()
  const sources: RecommendationEvidence[] = []
  function add(id: string, label: string, data: unknown, reference = id, at = observedAt) {
    // PostgREST returns timezone offsets and microseconds. Retain the same instant
    // in the canonical UTC format accepted by both evidence and saved documents.
    sources.push(recommendationEvidence.parse({ id, label, reference: reference.slice(0, 200), observedAt: new Date(at).toISOString(), data: json(data) }))
  }
  add('marketing:coverage', 'Marketing dates, definitions and data quality', {
    start, end, priorStart, priorEnd, coverage: report.coverage,
    omittedInvalidCurrentRows: current.length - normalizedCurrent.length,
    omittedInvalidPreviousRows: previous.length - normalizedPrevious.length,
    definitions: 'USD where confirmed. Conversions are provider-attributed actions, not deduplicated people or verified sales/leases. Missing rows do not prove zero activity. Cross-channel conversion definitions may differ.',
  })
  add('marketing:totals', 'Current and previous campaign performance', {
    current: report.totals, previous: report.comparison?.totals, changes: report.comparison?.changes,
    channels: report.channels, channelChanges: report.comparison?.channelChanges,
  })
  for (const campaign of report.campaigns.slice(0, 60)) {
    add(`campaign:${hash(campaign.campaign_key).slice(0, 24)}`, `${campaign.channel}: ${campaign.campaign_name}`.slice(0, 200), {
      current: campaign, previous: prior.campaigns.find(item => item.campaign_key === campaign.campaign_key) ?? null,
      start, end, priorStart, priorEnd,
    }, `campaign:${campaign.channel}:${campaign.source_account_id}:${campaign.campaign_id}`)
  }
  add('marketing:campaign-scope', 'Campaign analysis scope', {
    total: report.campaigns.length, included: Math.min(60, report.campaigns.length),
    selection: 'Up to 60 campaigns in descending current spend; previous-only campaigns are not individual recommendation candidates.',
  })
  add('outcomes:recorded', 'Recorded community outcomes and source limitations', {
    score: property.score, measures: property.periodMeasures, stageRatios: property.stageRatios,
    attribution: property.attribution, coverage: property.coverage, limitations: portfolio.limitations,
    note: 'Recorded system outcomes can be incomplete. No reported outcome is not proof of no real-world outcome. Preserve transaction-specific labels.',
  })
  add('knowledge:current', 'Current approved community knowledge', {
    facts: knowledge.canonical.facts.slice(0, 80),
    floorplans: knowledge.canonical.floorplans.slice(0, 40), brand: knowledge.canonical.brand,
    omittedFacts: Math.max(0, knowledge.canonical.facts.length - 80),
    omittedFloorplans: Math.max(0, knowledge.canonical.floorplans.length - 40),
    evidence: knowledge.evidence.filter(item => item.allowedUses.includes('fact')).slice(0, 20).map(item => ({
      id: item.id, evidenceId: item.evidenceId, sourceHash: item.sourceHash, content: item.content,
      authority: item.authority, allowedUses: item.allowedUses,
    })),
  }, `community-knowledge:${knowledge.readSetHash}`)
  add('market:coverage', 'Saved market observations and coverage', {
    competitors: property.market.competitors, limited: property.market.limited, note: property.market.note,
    capturedSources: research.documents.filter(d => d.status === 'captured').length,
    limitations: research.result?.limitations ?? ['No completed comparative research is available.'],
  })
  const captured = research.documents.filter(d => d.status === 'captured')
    .sort((a, b) => Number(b.entityKey === 'subject') - Number(a.entityKey === 'subject') || a.id.localeCompare(b.id))
  for (const document of captured.slice(0, 40)) add(`market:${document.id}`, document.title.slice(0, 200) || 'Captured market source', {
    entityKey: document.entityKey, url: document.url, capturedAt: document.fetchedAt,
    excerpt: document.excerpt, sourceKind: document.kind,
    note: 'Bounded excerpt of public claims, not independent verification. An unmentioned fact is unknown.',
  }, document.url, document.fetchedAt)
  if (captured.length > 40) add('market:omitted', 'Additional market evidence outside this analysis', { omittedDocuments: captured.length - 40 })
  const model = communityModel(knowledge.canonical.property)
  const input = { property: { id: propertyId, name: property.score.name, model }, start, end, sources }
  if (JSON.stringify(input).length > 180000) throw new IntelligenceError('The source material exceeds this analysis limit. Choose a shorter reporting period.', 422)
  await requireCurrentScope(scope, propertyId)
  return { input, scope }
}

export async function generatePropertyRecommendations(propertyId: string, start: string, end: string) {
  const actor = await intelligenceActor(propertyId, true)
  if (!process.env.OPENAI_API_KEY) throw new IntelligenceError('AI recommendations are temporarily unavailable. Please retry later.', 503)
  const { input, scope } = await recommendationContext(actor, propertyId, start, end).catch(error => {
    if (error instanceof z.ZodError) throw analysisFailure('source', error)
    throw error
  })
  // Read timestamps change between retries; source content, reporting periods and
  // source timestamps inside the data determine whether the analysis is reusable.
  const sourceHash = hash({ ...input, version: 1, model: process.env.INTELLIGENCE_RECOMMENDATION_MODEL || 'gpt-5.4',
    sources: input.sources.map(source => ({ id: source.id, label: source.label, reference: source.reference, data: source.data })) })
  const key = `ai-recommendations:${sourceHash}`
  const existing = (await readDocuments(propertyId, ['recommendation'])).find(doc => doc.key === key)
  if (existing) return { document: existing, reused: true }
  const output = await generateRecommendationAnalysis(input).catch(error => { throw analysisFailure('model', error) })
  await intelligenceActor(propertyId, true)
  await requireCurrentScope(scope, propertyId)
  const generatedAt = new Date().toISOString()
  const generation = { version: 1 as const, ...output, sourceHash, start, end, generatedAt, sources: input.sources }
  const parsedPayload = recommendationSchema.safeParse({
    generation, title: `AI recommendations · ${start} to ${end}`, rationale: output.summary,
    targetMetric: 'Marketing performance', owner: 'AI analysis', executionType: 'data', confidence: 'medium',
    evidence: input.sources.slice(0, 30).map(({ label, reference, observedAt }) => ({ label, reference, observedAt })),
    basecampUrl: '', expectedImpact: 'Proposed tests; outcomes require measurement.', rollback: 'Each recommendation includes its own stop or reversal conditions.',
    result: '', releaseEvent: null, measurementEvent: null,
  })
  if (!parsedPayload.success) throw analysisFailure('saved_output', parsedPayload.error)
  const payload = parsedPayload.data
  const id = hash(`${propertyId}:${key}`)
  const requestId = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-a${id.slice(17, 20)}-${id.slice(20, 32)}`
  try {
    return { ...(await saveDocument(actor, { propertyId, requestId, kind: 'recommendation', key,
      expectedRevision: 0, operation: 'save', payload, reason: `AI-generated recommendations (${output.model}); cited evidence retained; proposed actions only.`,
    }, { aiGeneration: true })), reused: false }
  } catch (error) {
    // Concurrent requests may have completed this same snapshot. Adopt the retained
    // analysis instead of overwriting it or duplicating its history.
    const saved = (await readDocuments(propertyId, ['recommendation'])).find(doc => doc.key === key)
    if (saved) return { document: saved, reused: true }
    throw error
  }
}
