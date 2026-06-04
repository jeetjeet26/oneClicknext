/**
 * PropertyAudit Recommendation Engine
 * Analyzes GEO gaps and generates actionable content suggestions
 */

import { createClient } from '@/utils/supabase/server'
import { auditPublicSiteForProperty, type PublicSiteAudit, type PublicSitePageAudit, type PublicSitePageType } from './public-site-audit'
import {
  getSurfaceLabel,
  type RecommendationAccessLevel,
  type RecommendationOwner,
  type RecommendationStatus,
  type Surface,
} from './types'
import { getPropertyTypeConfig, type PropertyTypeConfig } from '@/utils/property-types'

export interface ContentRecommendation {
  id: string
  type: 'missing_keyword' | 'content_gap' | 'citation_opportunity' | 'rank_improvement' | 'voice_search'
  priority: 'high' | 'medium' | 'low'
  title: string
  description: string
  accessLevel?: RecommendationAccessLevel
  owner?: RecommendationOwner
  status?: RecommendationStatus
  targetUrl?: string | null
  targetPageType?: string | null
  evidenceMode?: 'URLOnly' | 'CodeAware'
  evidence?: string[]
  implementationSteps?: string[]
  acceptanceCriteria?: string[]
  detectedOnUrls?: string[]
  missingSignals?: string[]
  sourceQueryEvidence?: string[]
  keywords: string[]
  competitorContext?: {
    competitorName: string
    competitorDomain: string
    avgRank: number
  }
  modelBreakdown?: {
    openai: {
      presence: boolean
      rank: number | null
      sov: number | null
    } | null
    claude: {
      presence: boolean
      rank: number | null
      sov: number | null
    } | null
    affectedModels: ('openai' | 'claude')[]
  }
  surfaceBreakdown?: Record<string, {
    label: string
    presence: boolean
    rank: number | null
    sov: number | null
  }>
  impact: {
    score: number // 0-100 estimated impact
    reason: string
  }
  actionItems: string[]
  relatedQueries: Array<{
    id: string
    text: string
    type: string
  }>
}

export interface RecommendationSummary {
  totalRecommendations: number
  highPriority: number
  mediumPriority: number
  lowPriority: number
  categories: {
    missingKeywords: number
    contentGaps: number
    citationOpportunities: number
    rankImprovement: number
    voiceSearch: number
  }
}

type RecommendationScope = {
  runId?: string | null
  batchId?: string | null
  runIds?: string[]
}

type AnalysisRun = {
  id: string
  surface: Surface
  batchId: string | null
  startedAt: string | null
  score: number | null
  visibilityPct: number | null
  avgLlmRank: number | null
  avgSov: number | null
}

type AnalysisCitation = {
  url: string
  domain: string
  isBrandDomain: boolean
  answerId: string
  queryId: string
  surface: Surface | null
}

type QuerySignal = {
  query: AnalysisContext['queries'][number]
  answers: AnalysisContext['answers']
  affectedSurfaces: Surface[]
  presentSurfaces: Surface[]
  presenceRate: number
  avgRank: number | null
  avgSov: number | null
  aiOverviewVisible: boolean
  aiOverviewSource: string | null
  citations: AnalysisCitation[]
}

interface AnalysisContext {
  propertyId: string
  brandName: string
  propertyType: PropertyTypeConfig
  websiteUrl: string | null
  brandDomains: string[]
  primaryGeo: string | null
  siteAudit: PublicSiteAudit
  runIds: string[]
  runs: AnalysisRun[]
  queries: Array<{
    id: string
    text: string
    type: string
    geo: string | null
    weight?: number | null
  }>
  answers: Array<{
    id: string
    queryId: string
    runId: string
    presence: boolean
    llmRank: number | null
    linkRank: number | null
    sov: number | null
    flags: string[]
    answerSummary: string | null
    orderedEntities: Array<{
      name: string
      domain: string
      position: number
      rationale: string
    }>
  }>
  citations: AnalysisCitation[]
  aiOverviews: Map<string, { visible: boolean; sourceUrl: string | null }>
  runsBySurface: Map<string, Surface>
  competitors: Array<{
    name: string
    domain: string
    mentionCount: number
    avgRank: number
  }>
}

/**
 * Generates recommendations from GEO run data
 */
export async function generateRecommendations(
  propertyId: string,
  runIdOrScope?: string | RecommendationScope
): Promise<{ recommendations: ContentRecommendation[]; summary: RecommendationSummary }> {
  const supabase = await createClient()
  const scope = typeof runIdOrScope === 'string' ? { runId: runIdOrScope } : (runIdOrScope || {})

  // Fetch analysis context
  const context = await fetchAnalysisContext(supabase, propertyId, scope)

  // Generate strategic workstreams first, then technical site fixes.
  const recommendations: ContentRecommendation[] = dedupeRecommendations([
    ...buildStrategicInitiatives(context),
    ...identifyTechnicalDiscoverabilityGaps(context),
  ])

  // If no recommendations (perfect performance), add maintenance suggestions
  if (recommendations.length === 0) {
    recommendations.push(...generateMaintenanceRecommendations(context))
  }

  // Sort by priority and impact
  recommendations.sort((a, b) => {
    const priorityWeight = { high: 3, medium: 2, low: 1 }
    if (priorityWeight[a.priority] !== priorityWeight[b.priority]) {
      return priorityWeight[b.priority] - priorityWeight[a.priority]
    }
    return b.impact.score - a.impact.score
  })

  const enrichedRecommendations = recommendations.map(rec => enrichRecommendation(rec, context))

  // Generate summary
  const summary = generateSummary(enrichedRecommendations)

  return { recommendations: enrichedRecommendations, summary }
}

async function fetchAnalysisContext(
  supabase: any,
  propertyId: string,
  scope: RecommendationScope = {}
): Promise<AnalysisContext> {
  // Fetch property details
  const { data: property } = await supabase
    .from('properties')
    .select('name, website_url, address, property_type')
    .eq('id', propertyId)
    .single()

  // Fetch queries
  const { data: queries } = await supabase
    .from('geo_queries')
    .select('id, text, type, geo, weight')
    .eq('property_id', propertyId)
    .eq('is_active', true)

  // Fetch recent runs (or specific run)
  let runsQuery = supabase
    .from('geo_runs')
    .select('id, surface, batch_id, started_at, geo_scores(overall_score, visibility_pct, avg_llm_rank, avg_sov)')
    .eq('property_id', propertyId)
    .eq('status', 'completed')
    .order('started_at', { ascending: false })

  if (scope.runIds?.length) {
    runsQuery = runsQuery.in('id', scope.runIds)
  } else if (scope.batchId) {
    runsQuery = runsQuery.eq('batch_id', scope.batchId)
  } else if (scope.runId) {
    runsQuery = runsQuery.eq('id', scope.runId).limit(1)
  } else {
    // Get the latest completed multi-surface batch when possible.
    runsQuery = runsQuery.limit(6)
  }

  const { data: runs } = await runsQuery

  const runIds = runs?.map((r: any) => r.id) || []
  const runsBySurface = new Map<string, Surface>()
  runs?.forEach((r: any) => {
    runsBySurface.set(r.id, r.surface as Surface)
  })
  const analysisRuns: AnalysisRun[] = (runs || []).map((run: any) => {
    const score = Array.isArray(run.geo_scores) ? run.geo_scores[0] : null
    return {
      id: run.id,
      surface: run.surface as Surface,
      batchId: run.batch_id || null,
      startedAt: run.started_at || null,
      score: asNullableNumber(score?.overall_score),
      visibilityPct: asNullableNumber(score?.visibility_pct),
      avgLlmRank: asNullableNumber(score?.avg_llm_rank),
      avgSov: asNullableNumber(score?.avg_sov),
    }
  })

  // Fetch answers for these runs
  // Note: If no runs, avoid .in() with empty array which returns no results
  let rawAnswers: any[] = []
  if (runIds.length > 0) {
    const { data } = await supabase
      .from('geo_answers')
      .select('id, query_id, run_id, presence, llm_rank, link_rank, sov, flags, answer_summary, ordered_entities, geo_citations(url, domain, is_brand_domain)')
      .in('run_id', runIds)
    rawAnswers = data || []
  }

  // Transform snake_case from Supabase to camelCase expected by the engine
  const answers = rawAnswers.map((a: any) => ({
    id: a.id,
    queryId: a.query_id,
    runId: a.run_id,
    presence: a.presence,
    llmRank: a.llm_rank,
    linkRank: a.link_rank,
    sov: a.sov,
    flags: Array.isArray(a.flags) ? a.flags : [],
    answerSummary: a.answer_summary || null,
    orderedEntities: a.ordered_entities || [],
  }))

  const citations: AnalysisCitation[] = rawAnswers.flatMap((answer: any) => {
    const surface = runsBySurface.get(answer.run_id) || null
    return (answer.geo_citations || []).map((citation: any) => ({
      url: citation.url || '',
      domain: normalizeDomain(citation.domain || citation.url || ''),
      isBrandDomain: Boolean(citation.is_brand_domain),
      answerId: answer.id,
      queryId: answer.query_id,
      surface,
    }))
  }).filter((citation: AnalysisCitation) => citation.domain.length > 0)

  const aiOverviews = new Map<string, { visible: boolean; sourceUrl: string | null }>()
  const { data: overviewRows } = await supabase
    .from('geo_ai_overviews')
    .select('query_id, visible, source_url, observed_at')
    .eq('property_id', propertyId)
    .order('observed_at', { ascending: false })
  ;(overviewRows || []).forEach((row: any) => {
    if (row.query_id && !aiOverviews.has(row.query_id)) {
      aiOverviews.set(row.query_id, {
        visible: Boolean(row.visible),
        sourceUrl: row.source_url || null,
      })
    }
  })

  let propertyConfig: any = null
  try {
    const { data } = await supabase
      .from('geo_property_config')
      .select('domains, competitor_domains, primary_geo, visibility_target')
      .eq('property_id', propertyId)
      .maybeSingle()
    propertyConfig = data || null
  } catch {
    propertyConfig = null
  }

  const brandDomains = new Set<string>()
  ;(propertyConfig?.domains || []).forEach((domain: string) => {
    const normalized = normalizeDomain(domain)
    if (normalized) brandDomains.add(normalized)
  })
  if (property?.website_url) {
    const normalized = normalizeDomain(property.website_url)
    if (normalized) brandDomains.add(normalized)
  }

  // Build competitor insights from answers
  const competitorMap = new Map<string, { name: string; domain: string; mentions: number[] }>()
  
  answers.forEach((answer) => {
    if (answer.orderedEntities && Array.isArray(answer.orderedEntities)) {
      answer.orderedEntities.forEach((entity: any) => {
        if (!isRelevantEntity(entity, property?.name || 'Property', Array.from(brandDomains))) return
        const key = normalizeDomain(entity.domain || entity.name)
        if (!competitorMap.has(key)) {
          competitorMap.set(key, {
            name: entity.name,
            domain: key,
            mentions: [],
          })
        }
        competitorMap.get(key)!.mentions.push(entity.position)
      })
    }
  })

  const competitors = Array.from(competitorMap.entries())
    .map(([domain, data]) => ({
      name: data.name,
      domain,
      mentionCount: data.mentions.length,
      avgRank: data.mentions.reduce((a, b) => a + b, 0) / data.mentions.length,
    }))
    .sort((a, b) => b.mentionCount - a.mentionCount)

  return {
    propertyId,
    brandName: property?.name || 'Your Property',
    propertyType: getPropertyTypeConfig(property?.property_type),
    websiteUrl: property?.website_url || null,
    brandDomains: Array.from(brandDomains),
    primaryGeo: propertyConfig?.primary_geo || buildPrimaryGeo(property?.address),
    siteAudit: await auditPublicSiteForProperty(supabase, propertyId, property?.website_url || null),
    runIds,
    runs: analysisRuns,
    queries: queries || [],
    answers,
    citations,
    aiOverviews,
    runsBySurface,
    competitors,
  }
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeDomain(value: string | null | undefined): string {
  if (!value) return ''
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`
    return new URL(withProtocol).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return value
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      .trim()
      .toLowerCase()
  }
}

function buildPrimaryGeo(address: any): string | null {
  if (!address || typeof address !== 'object') return null
  return [address.city, address.state].filter(Boolean).join(', ') || null
}

function isRelevantEntity(
  entity: { name?: string; domain?: string | null },
  brandName: string,
  brandDomains: string[]
): boolean {
  const name = (entity.name || '').trim().toLowerCase()
  const domain = normalizeDomain(entity.domain || '')
  if (!name && !domain) return false
  if (name === brandName.toLowerCase()) return false
  if (domain && brandDomains.includes(domain)) return false
  if (isNonCompetitiveEntity(name, domain)) return false
  return true
}

const NON_COMPETITIVE_DOMAIN_PATTERNS = [
  /(?:^|\.)facebook\.com$/,
  /(?:^|\.)youtube\.com$/,
  /(?:^|\.)youtu\.be$/,
  /(?:^|\.)instagram\.com$/,
  /(?:^|\.)tiktok\.com$/,
  /(?:^|\.)twitter\.com$/,
  /(?:^|\.)x\.com$/,
  /(?:^|\.)reddit\.com$/,
  /(?:^|\.)quora\.com$/,
  /(?:^|\.)wikipedia\.org$/,
  /(?:^|\.)wiktionary\.org$/,
  /(?:^|\.)merriam-webster\.com$/,
  /(?:^|\.)dictionary\.com$/,
  /(?:^|\.)cambridge\.org$/,
  /(?:^|\.)spotify\.com$/,
  /(?:^|\.)soundcloud\.com$/,
  /(?:^|\.)genius\.com$/,
  /(?:^|\.)lyrics\.com$/,
]

function isNonCompetitiveEntity(name: string, domain: string): boolean {
  if (domain && NON_COMPETITIVE_DOMAIN_PATTERNS.some(pattern => pattern.test(domain))) return true
  if (/(facebook|youtube|tiktok|instagram|reddit|quora)\s*(group|post|video|short|thread|comment)?/.test(name)) return true
  if (/(song|lyrics|radio mix|music video|official video|come on down)/.test(name)) return true
  if (/(what does|meaning of|definition of|word\s+["']?era|century)/.test(name)) return true
  return false
}

function isLikelyNoiseDomain(domain: string, relatedQueries: string[] = []): boolean {
  const normalized = normalizeDomain(domain)
  if (!normalized) return true
  const queryText = relatedQueries.join(' ').toLowerCase()
  if (/(sports|yahoo|espn|quora|stackexchange|wikipedia)\./i.test(normalized)) {
    return /(eastlake|millennia|millenium|millennium|vs)/i.test(queryText)
  }
  return false
}

function buildStrategicInitiatives(context: AnalysisContext): ContentRecommendation[] {
  const signals = buildQuerySignals(context)
  const recs: ContentRecommendation[] = []
  const categorySignals = signals.filter(signal => signal.query.type === 'category')
  const localSignals = signals.filter(signal => signal.query.type === 'local')
  const comparisonSignals = signals.filter(signal => signal.query.type === 'comparison')
  const voiceSignals = signals.filter(signal => signal.query.type === 'voice_search' || signal.query.type === 'faq')
  const primarySearchTerm = context.propertyType.searchNouns[0]
  const pluralDisplayNoun = context.propertyType.pluralDisplayNoun
  const structuredDataType = context.propertyType.isForSaleResidential ? 'RealEstateAgent/LocalBusiness' : 'ApartmentComplex/LocalBusiness'
  const marketLabel = context.primaryGeo || 'the local market'

  const weakDemandSignals = [...categorySignals, ...localSignals]
    .filter(signal => signal.presenceRate < 0.5 || !signal.aiOverviewVisible || signal.avgSov === 0)

  if (weakDemandSignals.length > 0) {
    const topPrompts = weakDemandSignals
      .sort((a, b) => a.presenceRate - b.presenceRate)
      .slice(0, 6)
    const localGeo = context.primaryGeo || inferGeoFromSignals(topPrompts)
    recs.push(makeStrategicRecommendation({
      id: 'strategy-owned-local-category-demand',
      type: 'content_gap',
      priority: 'high',
      title: buildDemandCaptureTitle(context, topPrompts),
      description: `${context.brandName} is weak on non-branded discovery: category presence is ${formatPct(avgPresence(categorySignals))} and local presence is ${formatPct(avgPresence(localSignals))}. This is where prospects ask for places, communities, and ${primarySearchTerm} before they know the brand.`,
      relatedSignals: topPrompts,
      keywords: topPrompts.map(signal => signal.query.text),
      targetPageType: 'local_landing_page',
      targetUrl: suggestOwnedPageUrl(context, buildDemandPageSlug(context, localGeo)),
      accessLevel: 'CMSOrEditor',
      owner: 'content',
      impactScore: 90,
      impactReason: 'Highest upside: non-branded local/category prompts are the main gap and can be influenced with owned answer-ready pages.',
      implementationSteps: [
        `Create or strengthen an "${localGeo || 'local market'} ${primarySearchTerm} demand page" that answers the tracked prompts directly above the fold.`,
        `Use H2 blocks for: ${topPrompts.slice(0, 4).map(signal => signal.query.text).join('; ')}.`,
        'Add short answer-first copy for each prompt before lifestyle copy, including neighborhood, product type, rent/ownership distinction, amenities, and proximity claims.',
        'Internally link this page from the homepage, FAQ, lifestyle, location, and floorplan pages with descriptive anchor text.',
        `Add ${structuredDataType} JSON-LD and FAQPage JSON-LD where answers are visible on the page.`,
        `Use proof points from trusted sources; prioritize ${topCitationDomains(context, topPrompts).slice(0, 3).join(', ') || `local ${pluralDisplayNoun} and real estate sources`}.`,
      ],
      acceptanceCriteria: [
        'A crawlable owned page exists for the local/category prompt cluster and is linked in sitemap.xml and navigation or footer links.',
        'The page includes answer blocks for each related tracked prompt and the URL-only crawl detects those blocks.',
        'Relevant JSON-LD validates and includes property name, URL, address, phone if available, and sameAs/citation links.',
        `After rerun, category/local prompt presence improves and at least one selected LLM cites or names an owned ${context.brandName} URL.`,
      ],
    }))
  }

  const comparisonGaps = comparisonSignals.filter(signal => signal.presenceRate < 1 || (signal.avgRank || 99) > 1.5)
  if (comparisonGaps.length > 0) {
    recs.push(makeStrategicRecommendation({
      id: 'strategy-comparison-pages',
      type: 'rank_improvement',
      priority: 'high',
      title: 'Publish comparison content for the selected competitive set',
      description: `${context.brandName} is visible on comparison prompts, but rankings vary by surface. Comparison pages can control the framing and reduce ambiguity from unrelated competitor or market web results.`,
      relatedSignals: comparisonGaps,
      keywords: comparisonGaps.map(signal => signal.query.text),
      targetPageType: 'comparison_page',
      targetUrl: suggestOwnedPageUrl(context, 'compare'),
      accessLevel: 'CMSOrEditor',
      owner: 'seo',
      impactScore: 86,
      impactReason: 'Comparison prompts are high-intent and already near visibility; better owned framing can push the property higher.',
      implementationSteps: [
        `Create a comparison hub or sections for ${context.brandName} against the tracked competitive set.`,
        `Compare location, ${marketLabel} context, product options, amenities, commute patterns, and lifestyle fit without attacking competitors.`,
        'Add a table-style answer block that directly answers each comparison prompt in 2-4 sentences.',
        'Add FAQPage schema for comparison questions and link the page from location/neighborhood pages.',
        'Use exact phrasing from the tracked prompts in headings and page intro copy.',
      ],
      acceptanceCriteria: [
        'Comparison page or sections are crawlable and linked from the site.',
        `Page copy includes the exact comparison prompt language and clear ${context.brandName} differentiators.`,
        `Next PropertyAudit run shows fewer irrelevant comparison entities and stronger ${context.brandName} rank across selected surfaces.`,
      ],
    }))
  }

  const faqPageMissing = context.siteAudit.missingPageTypes?.includes('faq') || false
  const faqSchemaMissing = !context.siteAudit.faqStructuredData
  const faqNeedsWork = faqPageMissing || faqSchemaMissing
  if (voiceSignals.some(signal => signal.presenceRate < 1) || faqNeedsWork) {
    recs.push(makeStrategicRecommendation({
      id: 'strategy-faq-answer-schema',
      type: 'voice_search',
      priority: faqNeedsWork ? 'medium' : 'low',
      title: 'Turn leasing questions into answer-ready FAQ content',
      description: faqPageMissing
        ? 'Voice and branded support prompts perform well, but a crawlable FAQ page with entity markup will make those answers more reliably citeable.'
        : 'The FAQ page is reachable; stronger FAQ/entity schema and answer blocks will make those answers more reliably citeable.',
      relatedSignals: voiceSignals.slice(0, 5),
      keywords: voiceSignals.map(signal => signal.query.text),
      targetPageType: 'faq_or_support_page',
      targetUrl: suggestOwnedPageUrl(context, 'faq'),
      accessLevel: 'CodeRequired',
      owner: 'engineering',
      impactScore: 72,
      impactReason: 'FAQ schema and visible answer blocks improve extraction confidence for voice, branded, and support-style AI answers.',
      implementationSteps: [
        faqPageMissing
          ? `Add a public FAQ page with visible answers for application, amenities, availability, parking, pets, tours, and ${marketLabel} questions.`
          : `Strengthen the existing FAQ page with visible answers for application, amenities, availability, parking, pets, tours, and ${marketLabel} questions.`,
        'Wrap each answer in concise 40-80 word blocks that can be quoted by answer engines.',
        faqSchemaMissing
          ? 'Add FAQPage JSON-LD that exactly matches the visible FAQ content.'
          : 'Validate existing FAQPage JSON-LD against the visible FAQ content.',
        `Add Organization or ${structuredDataType} JSON-LD on the homepage with canonical URL, address, phone, and sameAs links.`,
      ],
      acceptanceCriteria: [
        faqPageMissing
          ? 'FAQ page returns HTTP 200 and is linked from sitemap.xml and navigation/footer.'
          : 'Existing FAQ page remains reachable and is linked from sitemap.xml and navigation/footer.',
        `Structured data validator passes for FAQPage and ${structuredDataType}/Organization schema.`,
        'URL-only crawl detects FAQ schema or answer-block signals on relevant pages.',
      ],
    }))
  }

  const citationTargets = buildCitationTargets(context)
  if (citationTargets.length > 0) {
    recs.push({
      id: 'strategy-citation-authority',
      type: 'citation_opportunity',
      priority: 'medium',
      title: 'Build citation authority on the sources AI already uses',
      description: `Brand citation share is ${formatPct(calculateBrandCitationShare(context))}. Improve AI rankings by strengthening the trusted third-party sources that already appear in answers.`,
      accessLevel: 'ThirdParty',
      owner: 'partnerships',
      status: 'todo',
      evidenceMode: 'URLOnly',
      keywords: citationTargets.slice(0, 5).map(target => target.domain),
      evidence: citationTargets.slice(0, 5).map(target =>
        `${target.domain} appears ${target.count} time(s) across: ${target.queries.slice(0, 3).join(', ')}.`
      ),
      implementationSteps: [
        `Update or claim priority listings: ${citationTargets.slice(0, 5).map(target => target.domain).join(', ')}.`,
        'Make NAP, website URL, property description, floorplan/availability messaging, and images consistent across listings.',
        `Add ${context.brandName}-specific ${marketLabel} language to directory/social/video descriptions where editable.`,
        `Create one shareable media asset or short video that supports the ${marketLabel} positioning and link it from owned pages.`,
      ],
      acceptanceCriteria: [
        'Priority third-party listings contain consistent name, address, URL, property description, and current imagery.',
        'Owned pages link to or reference the strongest third-party proof points where appropriate.',
        'Next PropertyAudit run shows improved brand citation share or lower link rank on category/local prompts.',
      ],
      impact: {
        score: 78,
        reason: 'AI answers are citing third-party domains heavily; stronger controlled listings increase attribution odds.',
      },
      actionItems: citationTargets.slice(0, 5).map(target => `Strengthen ${target.domain} listing/citation`),
      relatedQueries: citationTargets.flatMap(target => target.queries).slice(0, 5).map(text => ({
        id: '',
        text,
        type: 'citation',
      })),
    })
  }

  return recs
}

function buildQuerySignals(context: AnalysisContext): QuerySignal[] {
  return context.queries.map(query => {
    const answers = context.answers.filter(answer => answer.queryId === query.id)
    const present = answers.filter(answer => answer.presence)
    const ranks = present.map(answer => answer.llmRank).filter((rank): rank is number => typeof rank === 'number')
    const sovs = answers.map(answer => answer.sov).filter((sov): sov is number => typeof sov === 'number')
    const aiOverview = context.aiOverviews.get(query.id)
    return {
      query,
      answers,
      affectedSurfaces: answers
        .filter(answer => !answer.presence)
        .map(answer => context.runsBySurface.get(answer.runId))
        .filter((surface): surface is Surface => Boolean(surface)),
      presentSurfaces: present
        .map(answer => context.runsBySurface.get(answer.runId))
        .filter((surface): surface is Surface => Boolean(surface)),
      presenceRate: answers.length > 0 ? present.length / answers.length : 0,
      avgRank: ranks.length > 0 ? average(ranks) : null,
      avgSov: sovs.length > 0 ? average(sovs) : null,
      aiOverviewVisible: Boolean(aiOverview?.visible),
      aiOverviewSource: aiOverview?.sourceUrl || null,
      citations: context.citations.filter(citation => citation.queryId === query.id),
    }
  })
}

function makeStrategicRecommendation(args: {
  id: string
  type: ContentRecommendation['type']
  priority: ContentRecommendation['priority']
  title: string
  description: string
  relatedSignals: QuerySignal[]
  keywords: string[]
  targetPageType: string
  targetUrl: string | null
  accessLevel: RecommendationAccessLevel
  owner: RecommendationOwner
  impactScore: number
  impactReason: string
  implementationSteps: string[]
  acceptanceCriteria: string[]
}): ContentRecommendation {
  const sourceQueryEvidence = args.relatedSignals.map(signal => {
    const details = [
      signal.affectedSurfaces.length > 0 ? `absent on ${surfaceList(signal.affectedSurfaces)}` : null,
      signal.presentSurfaces.length > 0 ? `present on ${surfaceList(signal.presentSurfaces)}${signal.avgRank ? `, avg rank #${signal.avgRank.toFixed(1)}` : ''}` : null,
      signal.aiOverviewVisible ? 'visible in AI Overview' : 'not visible in AI Overview',
    ].filter(Boolean).join('; ')
    return `"${signal.query.text}" (${signal.query.type}): ${details}.`
  })

  return {
    id: args.id,
    type: args.type,
    priority: args.priority,
    title: args.title,
    description: args.description,
    accessLevel: args.accessLevel,
    owner: args.owner,
    status: 'todo',
    targetPageType: args.targetPageType,
    targetUrl: args.targetUrl,
    evidenceMode: 'URLOnly',
    evidence: [],
    implementationSteps: args.implementationSteps,
    acceptanceCriteria: args.acceptanceCriteria,
    sourceQueryEvidence: Array.from(new Set(sourceQueryEvidence)).slice(0, 8),
    keywords: Array.from(new Set(args.keywords)).slice(0, 10),
    impact: { score: args.impactScore, reason: args.impactReason },
    actionItems: args.implementationSteps.slice(0, 4),
    relatedQueries: args.relatedSignals.map(signal => ({
      id: signal.query.id,
      text: signal.query.text,
      type: signal.query.type,
    })),
  }
}

function buildDemandCaptureTitle(context: AnalysisContext, signals: QuerySignal[]): string {
  const geo = context.primaryGeo || inferGeoFromSignals(signals)
  return `Build a ${geo || 'local'} ${context.propertyType.searchNouns[0]} demand-capture page`
}

function buildDemandPageSlug(context: AnalysisContext, geo: string | null): string {
  const base = slugify(context.propertyType.searchNouns[0] || context.propertyType.displayNoun)
  const market = slugify(geo || context.primaryGeo || 'local')
  return market ? `${base}-${market}` : base
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function suggestOwnedPageUrl(context: AnalysisContext, slug: string): string | null {
  if (!context.siteAudit.normalizedOrigin) return null
  try {
    return new URL(`/${slug.replace(/^\/+/, '')}/`, context.siteAudit.normalizedOrigin).toString()
  } catch {
    return null
  }
}

function inferGeoFromSignals(signals: QuerySignal[]): string | null {
  return signals.map(signal => signal.query.geo).find(Boolean) || null
}

function avgPresence(signals: QuerySignal[]): number {
  if (signals.length === 0) return 0
  return average(signals.map(signal => signal.presenceRate))
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function surfaceList(surfaces: Surface[]): string {
  return Array.from(new Set(surfaces)).map(getSurfaceLabel).join(', ')
}

function calculateBrandCitationShare(context: AnalysisContext): number {
  if (context.citations.length === 0) return 0
  return context.citations.filter(citation => citation.isBrandDomain).length / context.citations.length
}

function buildCitationTargets(context: AnalysisContext) {
  const queryTextById = new Map(context.queries.map(query => [query.id, query.text]))
  const targets = new Map<string, { domain: string; count: number; queries: Set<string> }>()
  context.citations.forEach(citation => {
    if (citation.isBrandDomain) return
    if (context.brandDomains.includes(citation.domain)) return
    const queryText = queryTextById.get(citation.queryId) || ''
    if (isLikelyNoiseDomain(citation.domain, [queryText])) return
    const existing = targets.get(citation.domain) || { domain: citation.domain, count: 0, queries: new Set<string>() }
    existing.count += 1
    if (queryText) existing.queries.add(queryText)
    targets.set(citation.domain, existing)
  })
  return Array.from(targets.values())
    .filter(target => target.domain && target.count >= 2)
    .sort((a, b) => b.count - a.count)
    .map(target => ({ domain: target.domain, count: target.count, queries: Array.from(target.queries) }))
}

function topCitationDomains(context: AnalysisContext, signals: QuerySignal[]) {
  const ids = new Set(signals.map(signal => signal.query.id))
  return buildCitationTargets({
    ...context,
    citations: context.citations.filter(citation => ids.has(citation.queryId)),
  }).map(target => target.domain)
}

function dedupeRecommendations(recommendations: ContentRecommendation[]): ContentRecommendation[] {
  const seen = new Set<string>()
  return recommendations.filter(recommendation => {
    const key = `${recommendation.type}:${recommendation.title}:${recommendation.targetUrl || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Identify queries where brand has no presence
 */
function identifyMissingKeywords(context: AnalysisContext): ContentRecommendation[] {
  const recommendations: ContentRecommendation[] = []

  // Group answers by query
  const answersByQuery = new Map<string, typeof context.answers>()
  context.answers.forEach(answer => {
    if (!answersByQuery.has(answer.queryId)) {
      answersByQuery.set(answer.queryId, [])
    }
    answersByQuery.get(answer.queryId)!.push(answer)
  })

  // Find queries with no presence
  context.queries.forEach(query => {
    const answers = answersByQuery.get(query.id) || []
    const hasPresence = answers.some(a => a.presence)

    if (!hasPresence && answers.length > 0) {
      // Check who IS appearing for this query
      const appearingCompetitors = new Set<string>()
      answers.forEach(answer => {
        if (answer.orderedEntities && Array.isArray(answer.orderedEntities)) {
          answer.orderedEntities.slice(0, 3).forEach(entity => {
            appearingCompetitors.add(`${entity.name} (${entity.domain})`)
          })
        }
      })

      const competitorList = Array.from(appearingCompetitors).slice(0, 3)

      // Build per-model breakdown
      const modelBreakdown = buildModelBreakdown(answers, context.runsBySurface)
      const affectedModels: ('openai' | 'claude')[] = []
      if (modelBreakdown.openai && !modelBreakdown.openai.presence) affectedModels.push('openai')
      if (modelBreakdown.claude && !modelBreakdown.claude.presence) affectedModels.push('claude')

      // Enhance description with model-specific info
      let description = `Your property is not mentioned in LLM responses for this ${query.type} query.`
      if (affectedModels.length === 1) {
        description += ` Issue affects ${affectedModels[0].toUpperCase()} only.`
      } else if (affectedModels.length === 2) {
        description += ` Issue affects both OpenAI and Claude.`
      }
      if (competitorList.length > 0) {
        description += ` Competitors appearing: ${competitorList.join(', ')}`
      }

      recommendations.push({
        id: `missing-${query.id}`,
        type: 'missing_keyword',
        priority: query.type === 'branded' ? 'high' : query.type === 'category' ? 'medium' : 'low',
        title: `No presence for: "${query.text}"`,
        description,
        keywords: [query.text],
        modelBreakdown: {
          ...modelBreakdown,
          affectedModels,
        },
        impact: {
          score: query.type === 'branded' ? 90 : query.type === 'category' ? 70 : 50,
          reason: query.type === 'branded' 
            ? 'Critical: Brand queries should always show your property'
            : 'Opportunity to capture search traffic',
        },
        actionItems: [
          `Create content targeting "${query.text}"`,
          `Optimize existing pages with this keyword`,
          `Build backlinks from authoritative sites`,
          query.geo ? `Focus content on ${query.geo} area` : 'Add geographic context',
        ],
        relatedQueries: [{ id: query.id, text: query.text, type: query.type }],
      })
    }
  })

  return recommendations
}

/**
 * Build per-model performance breakdown for a query
 */
function buildModelBreakdown(
  answers: AnalysisContext['answers'],
  runsBySurface: Map<string, Surface>
) {
  const openaiAnswer = answers.find(a => {
    const surface = runsBySurface.get(a.runId)
    return surface === 'openai' || surface === 'chatgpt'
  })
  const claudeAnswer = answers.find(a => runsBySurface.get(a.runId) === 'claude')

  return {
    openai: openaiAnswer ? {
      presence: openaiAnswer.presence,
      rank: openaiAnswer.llmRank,
      sov: openaiAnswer.sov,
    } : null,
    claude: claudeAnswer ? {
      presence: claudeAnswer.presence,
      rank: claudeAnswer.llmRank,
      sov: claudeAnswer.sov,
    } : null,
  }
}

function buildSurfaceBreakdown(
  answers: AnalysisContext['answers'],
  runsBySurface: Map<string, Surface>
): ContentRecommendation['surfaceBreakdown'] {
  const breakdown: NonNullable<ContentRecommendation['surfaceBreakdown']> = {}
  answers.forEach(answer => {
    const surface = runsBySurface.get(answer.runId)
    if (!surface || breakdown[surface]) return
    breakdown[surface] = {
      label: getSurfaceLabel(surface),
      presence: answer.presence,
      rank: answer.llmRank,
      sov: answer.sov,
    }
  })
  return breakdown
}

/**
 * Identify topics competitors cover that you don't
 */
function identifyContentGaps(context: AnalysisContext): ContentRecommendation[] {
  const recommendations: ContentRecommendation[] = []

  // Find queries where competitors rank higher
  const answersByQuery = new Map<string, typeof context.answers>()
  context.answers.forEach(answer => {
    if (!answersByQuery.has(answer.queryId)) {
      answersByQuery.set(answer.queryId, [])
    }
    answersByQuery.get(answer.queryId)!.push(answer)
  })

  context.queries.forEach(query => {
    const answers = answersByQuery.get(query.id) || []
    
    // Find where we rank vs competitors
    answers.forEach(answer => {
      if (answer.presence && answer.llmRank && answer.llmRank > 3) {
        // We're present but not in top 3
        const topCompetitors = answer.orderedEntities
          .slice(0, 3)
          .filter(e => e.position < answer.llmRank!)

        if (topCompetitors.length > 0) {
          const topComp = topCompetitors[0]
          const surface = context.runsBySurface.get(answer.runId)
          
          // Build model breakdown
          const modelBreakdown = buildModelBreakdown(answers, context.runsBySurface)
          const affectedModels: ('openai' | 'claude')[] = []
          if (modelBreakdown.openai && modelBreakdown.openai.rank && modelBreakdown.openai.rank > 3) {
            affectedModels.push('openai')
          }
          if (modelBreakdown.claude && modelBreakdown.claude.rank && modelBreakdown.claude.rank > 3) {
            affectedModels.push('claude')
          }

          let description = `You're mentioned but ${topComp.name} ranks higher (position #${topComp.position}). Reason: "${topComp.rationale}"`
          if (surface) {
            description += ` [${surface.toUpperCase()} issue]`
          }
          
          recommendations.push({
            id: `gap-${answer.id}`,
            type: 'content_gap',
            priority: answer.llmRank <= 5 ? 'medium' : 'low',
            title: `Ranking #${answer.llmRank} for: "${query.text}"`,
            description,
            keywords: [query.text],
            competitorContext: {
              competitorName: topComp.name,
              competitorDomain: topComp.domain,
              avgRank: topComp.position,
            },
            modelBreakdown: {
              ...modelBreakdown,
              affectedModels,
            },
            impact: {
              score: 60 - (answer.llmRank * 5), // Higher rank = lower impact
              reason: 'Improve ranking to increase visibility',
            },
            actionItems: [
              `Analyze ${topComp.domain} content strategy`,
              `Enhance content quality and depth`,
              `Add more specific details mentioned in competitor rationale`,
              `Improve on-page SEO for this keyword`,
            ],
            relatedQueries: [{ id: query.id, text: query.text, type: query.type }],
          })
        }
      }
    })
  })

  return recommendations
}

/**
 * Identify high-authority domains to target for backlinks
 */
function identifyCitationOpportunities(context: AnalysisContext): ContentRecommendation[] {
  const recommendations: ContentRecommendation[] = []

  // Track frequently cited domains that aren't brand domains
  const citationMap = new Map<string, { count: number; queries: Set<string> }>()

  context.answers.forEach(answer => {
    // Check if orderedEntities exists and is an array
    if (answer.orderedEntities && Array.isArray(answer.orderedEntities)) {
      answer.orderedEntities.forEach(entity => {
        const domain = entity.domain
        if (!citationMap.has(domain)) {
          citationMap.set(domain, { count: 0, queries: new Set() })
        }
        const data = citationMap.get(domain)!
        data.count++
        
        const query = context.queries.find(q => q.id === answer.queryId)
        if (query) {
          data.queries.add(query.text)
        }
      })
    }
  })

  // Find top cited domains (excluding top competitors)
  const topDomains = Array.from(citationMap.entries())
    .filter(([domain]) => !context.competitors.slice(0, 3).some(c => c.domain === domain))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)

  topDomains.forEach(([domain, data]) => {
    if (data.count >= 3) {
      recommendations.push({
        id: `citation-${domain}`,
        type: 'citation_opportunity',
        priority: 'medium',
        title: `Target ${domain} for citations`,
        description: `This domain appears ${data.count} times across multiple queries. Getting listed here could improve your GEO visibility.`,
        keywords: Array.from(data.queries).slice(0, 3),
        impact: {
          score: Math.min(75, 40 + data.count * 5),
          reason: 'High-authority domain frequently cited by LLMs',
        },
        actionItems: [
          `Research ${domain} submission process`,
          `Prepare property listing with optimized content`,
          `Ensure NAP (Name, Address, Phone) consistency`,
          `Add high-quality photos and descriptions`,
        ],
        relatedQueries: Array.from(data.queries).slice(0, 3).map(text => ({
          id: '',
          text,
          type: 'citation',
        })),
      })
    }
  })

  return recommendations
}

/**
 * Identify opportunities to improve existing rankings
 */
function identifyRankImprovements(context: AnalysisContext): ContentRecommendation[] {
  const recommendations: ContentRecommendation[] = []

  // Group by query and find trends
  const queryPerformance = new Map<string, { ranks: number[]; avgRank: number; answers: typeof context.answers }>()

  context.answers.forEach(answer => {
    if (answer.presence && answer.llmRank) {
      if (!queryPerformance.has(answer.queryId)) {
        queryPerformance.set(answer.queryId, { ranks: [], avgRank: 0, answers: [] })
      }
      const perf = queryPerformance.get(answer.queryId)!
      perf.ranks.push(answer.llmRank)
      perf.answers.push(answer)
    }
  })

  // Calculate averages
  queryPerformance.forEach((data, queryId) => {
    data.avgRank = data.ranks.reduce((a, b) => a + b, 0) / data.ranks.length
  })

  // Find queries where we're close to top 3
  queryPerformance.forEach((data, queryId) => {
    if (data.avgRank > 3 && data.avgRank <= 7) {
      const query = context.queries.find(q => q.id === queryId)
      if (query) {
        // Build model breakdown
        const modelBreakdown = buildModelBreakdown(data.answers, context.runsBySurface)
        const affectedModels: ('openai' | 'claude')[] = []
        if (modelBreakdown.openai && modelBreakdown.openai.rank && modelBreakdown.openai.rank > 3) {
          affectedModels.push('openai')
        }
        if (modelBreakdown.claude && modelBreakdown.claude.rank && modelBreakdown.claude.rank > 3) {
          affectedModels.push('claude')
        }

        let description = `Currently averaging position #${data.avgRank.toFixed(1)}. Small improvements could push you into top 3.`
        if (affectedModels.length === 1) {
          description += ` Issue primarily on ${affectedModels[0].toUpperCase()}.`
        }

        recommendations.push({
          id: `improve-${queryId}`,
          type: 'rank_improvement',
          priority: 'high',
          title: `Improve rank for: "${query.text}"`,
          description,
          keywords: [query.text],
          modelBreakdown: {
            ...modelBreakdown,
            affectedModels,
          },
          impact: {
            score: 85,
            reason: 'Quick win: Already visible, just need slight optimization',
          },
          actionItems: [
            `Refresh content with recent updates`,
            `Add more comprehensive information`,
            `Improve internal linking to this page`,
            `Get 2-3 new backlinks from relevant sites`,
          ],
          relatedQueries: [{ id: query.id, text: query.text, type: query.type }],
        })
      }
    }
  })

  return recommendations
}

/**
 * Identify voice/conversational search opportunities
 */
function identifyVoiceSearchOpportunities(context: AnalysisContext): ContentRecommendation[] {
  const recommendations: ContentRecommendation[] = []

  // FAQ queries are prime for voice search optimization
  const faqQueries = context.queries.filter(q => q.type === 'faq')

  faqQueries.forEach(query => {
    const answers = context.answers.filter(a => a.queryId === query.id)
    const hasPresence = answers.some(a => a.presence)

    if (!hasPresence) {
      recommendations.push({
        id: `voice-${query.id}`,
        type: 'voice_search',
        priority: 'low',
        title: `Voice search opportunity: "${query.text}"`,
        description: `This question-format query is ideal for voice search. Creating FAQ content could capture voice assistant queries.`,
        keywords: [query.text],
        impact: {
          score: 55,
          reason: 'Growing segment: Voice search adoption increasing',
        },
        actionItems: [
          `Create FAQ page with this question`,
          `Use natural, conversational language`,
          `Provide concise, direct answer (2-3 sentences)`,
          `Add schema markup for FAQ structured data`,
        ],
        relatedQueries: [{ id: query.id, text: query.text, type: query.type }],
      })
    }
  })

  return recommendations
}

function identifyTechnicalDiscoverabilityGaps(context: AnalysisContext): ContentRecommendation[] {
  const recommendations: ContentRecommendation[] = []
  const { siteAudit } = context

  if (!siteAudit.websiteUrl) {
    recommendations.push({
      id: 'site-audit-missing-url',
      type: 'content_gap',
      priority: 'high',
      title: 'Set the property website URL before running URL-only GEO audits',
      description:
        'A public website URL is required to map prompt gaps to owned pages, technical crawl signals, and content opportunities.',
      keywords: ['website url'],
      impact: {
        score: 80,
        reason: 'Without a public site URL, the audit cannot produce page-level or technical recommendations.',
      },
      actionItems: [
        'Save the public property website URL in the property record',
        'Re-run the GEO audit to unlock URL-only technical recommendations',
      ],
      evidence: siteAudit.notes,
      implementationSteps: [
        'Add the canonical public marketing website URL to the property record.',
        'Confirm the URL is publicly reachable without authentication.',
        'Re-run PropertyAudit so recommendations can map GEO gaps to owned pages.',
      ],
      acceptanceCriteria: [
        'The property record has a normalized HTTPS website URL.',
        'The URL-only audit can fetch the homepage successfully.',
        'Recommendations include exact owned-page targets instead of only missing URL guidance.',
      ],
      missingSignals: ['website_url'],
      relatedQueries: [],
    })
    return recommendations
  }

  if (!siteAudit.robotsTxtReachable || !siteAudit.sitemapReachable || !siteAudit.llmsTxtReachable) {
    recommendations.push({
      id: 'site-audit-discoverability',
      type: 'content_gap',
      priority: 'medium',
      title: 'Strengthen public-site discoverability signals',
      description: siteAudit.notes.join(' '),
      keywords: ['robots.txt', 'sitemap.xml', 'llms.txt'],
      impact: {
        score: 68,
        reason: 'Public crawlability and discovery files directly affect how quickly LLMs and search systems can interpret the site.',
      },
      actionItems: [
        siteAudit.robotsTxtReachable ? 'Review robots.txt rules for accidental crawl blocks' : 'Publish a reachable robots.txt file',
        siteAudit.sitemapReachable ? 'Ensure sitemap.xml includes current owned landing pages' : 'Publish a reachable sitemap.xml file',
        siteAudit.llmsTxtReachable ? 'Review llms.txt content for answer-engine clarity' : 'Publish an llms.txt file describing important public pages',
      ],
      evidence: [
        `Homepage reachable: ${siteAudit.homepageReachable ? 'yes' : 'no'}`,
        `robots.txt reachable: ${siteAudit.robotsTxtReachable ? 'yes' : 'no'}`,
        `sitemap.xml reachable: ${siteAudit.sitemapReachable ? 'yes' : 'no'}`,
        `llms.txt reachable: ${siteAudit.llmsTxtReachable ? 'yes' : 'no'}`,
        ...(siteAudit.notes || []).filter(note => /robots|sitemap|llms|homepage/i.test(note)),
      ],
      implementationSteps: [
        siteAudit.robotsTxtReachable
          ? 'Audit robots.txt and remove accidental blocks for public marketing pages.'
          : 'Publish /robots.txt with crawl access for public marketing pages.',
        siteAudit.sitemapReachable
          ? 'Update sitemap.xml so it includes homepage, floorplans, amenities, neighborhood, FAQ, and contact pages.'
          : 'Publish /sitemap.xml with canonical public marketing URLs.',
        siteAudit.llmsTxtReachable
          ? 'Update llms.txt with concise page descriptions for answer engines.'
          : 'Publish /llms.txt with the most important public page URLs and descriptions.',
      ],
      acceptanceCriteria: [
        '/robots.txt returns HTTP 200 and does not block public marketing pages.',
        '/sitemap.xml returns HTTP 200 and lists current canonical owned pages.',
        '/llms.txt returns HTTP 200 with answer-engine friendly page descriptions.',
      ],
      detectedOnUrls: [siteAudit.normalizedOrigin].filter(Boolean) as string[],
      missingSignals: [
        !siteAudit.robotsTxtReachable ? 'robots.txt' : null,
        !siteAudit.sitemapReachable ? 'sitemap.xml' : null,
        !siteAudit.llmsTxtReachable ? 'llms.txt' : null,
      ].filter(Boolean) as string[],
      relatedQueries: [],
    })
  }

  if (siteAudit.missingPageTypes?.length) {
    recommendations.push({
      id: 'site-audit-page-coverage',
      type: 'content_gap',
      priority: 'medium',
      title: 'Create or expose missing high-intent property pages',
      description:
        `The URL-only crawl did not find these important page types: ${siteAudit.missingPageTypes.map(type => type.replace('_', ' ')).join(', ')}.`,
      keywords: siteAudit.missingPageTypes.map(type => type.replace('_', ' ')),
      impact: {
        score: 70,
        reason: 'LLM answers need crawlable owned pages with specific leasing, neighborhood, and FAQ evidence.',
      },
      actionItems: siteAudit.missingPageTypes.slice(0, 4).map(type => `Create or expose a crawlable ${type.replace('_', ' ')} page`),
      evidence: [
        `${siteAudit.crawlSummary?.pagesAudited || 0} reachable page(s) audited from ${siteAudit.normalizedOrigin}.`,
        `Missing page types: ${siteAudit.missingPageTypes.map(type => type.replace('_', ' ')).join(', ')}.`,
      ],
      implementationSteps: siteAudit.missingPageTypes.slice(0, 4).map(type =>
        `Add a public ${type.replace('_', ' ')} page and include it in sitemap.xml and internal navigation.`
      ),
      acceptanceCriteria: siteAudit.missingPageTypes.slice(0, 4).map(type =>
        `The URL-only crawl detects a reachable ${type.replace('_', ' ')} page with answer-ready content.`
      ),
      detectedOnUrls: siteAudit.pages?.filter(page => page.reachable).map(page => page.url).slice(0, 5) || [],
      missingSignals: siteAudit.missingPageTypes,
      relatedQueries: [],
    })
  }

  if (!siteAudit.structuredDataTypes.length || !siteAudit.faqStructuredData || !siteAudit.organizationStructuredData) {
    recommendations.push({
      id: 'site-audit-structured-data',
      type: 'content_gap',
      priority: 'medium',
      title: 'Improve structured data for answer extraction',
      description:
        'Audited public pages are missing some structured data and answer-block signals that make GEO recommendations easier to ground and cite.',
      keywords: ['structured data', 'FAQ', 'Organization schema'],
      impact: {
        score: 64,
        reason: 'Structured data and answer-ready page sections improve extraction confidence and citation potential.',
      },
      actionItems: [
        siteAudit.organizationStructuredData
          ? 'Validate existing Organization / ApartmentComplex schema for accuracy'
          : 'Add Organization or ApartmentComplex structured data to the homepage',
        siteAudit.faqStructuredData
          ? 'Expand FAQ schema coverage to decision-stage questions'
          : 'Add FAQ structured data for pricing, application, and amenity questions',
        siteAudit.answerBlockSignals > 0
          ? 'Strengthen concise answer blocks near the top of key pages'
          : 'Add explicit answer-first blocks to FAQ, pricing, and amenity pages',
      ],
      evidence: [
        `Detected schema types: ${siteAudit.structuredDataTypes.length ? siteAudit.structuredDataTypes.join(', ') : 'none'}.`,
        `FAQPage schema: ${siteAudit.faqStructuredData ? 'present' : 'not detected'}.`,
        `Organization/ApartmentComplex schema: ${siteAudit.organizationStructuredData ? 'present' : 'not detected'}.`,
        `Answer-block signals found: ${siteAudit.answerBlockSignals}.`,
      ],
      implementationSteps: [
        siteAudit.organizationStructuredData
          ? 'Validate existing Organization or ApartmentComplex JSON-LD values for name, URL, address, phone, and sameAs links.'
          : 'Add Organization or ApartmentComplex JSON-LD to the homepage with name, URL, address, phone, and sameAs links.',
        siteAudit.faqStructuredData
          ? 'Expand FAQPage JSON-LD to cover pricing, application, amenity, pet, parking, and tour questions.'
          : 'Add FAQPage JSON-LD on the FAQ page or the page sections that answer leasing questions.',
        'Add concise answer-first blocks near the top of FAQ, pricing/floorplans, amenities, and neighborhood pages.',
      ],
      acceptanceCriteria: [
        'JSON-LD validates without parse errors in a structured data validator.',
        'The URL-only crawl detects Organization or ApartmentComplex schema.',
        'The URL-only crawl detects FAQPage schema or answer-block signals on relevant pages.',
      ],
      detectedOnUrls: (siteAudit.pages || [])
        .filter(page => page.reachable && (page.structuredDataTypes.length > 0 || page.answerBlockSignals > 0))
        .map(page => page.url)
        .slice(0, 5),
      missingSignals: [
        !siteAudit.organizationStructuredData ? 'Organization or ApartmentComplex schema' : null,
        !siteAudit.faqStructuredData ? 'FAQPage schema' : null,
        siteAudit.answerBlockSignals === 0 ? 'answer-first content blocks' : null,
      ].filter(Boolean) as string[],
      relatedQueries: [],
    })
  }

  return recommendations
}

/**
 * Generate maintenance recommendations when performance is excellent
 * Provides proactive suggestions to maintain dominance
 */
function generateMaintenanceRecommendations(context: AnalysisContext): ContentRecommendation[] {
  const recommendations: ContentRecommendation[] = []

  // Calculate overall performance
  const answersByQuery = new Map<string, typeof context.answers>()
  context.answers.forEach(answer => {
    if (!answersByQuery.has(answer.queryId)) {
      answersByQuery.set(answer.queryId, [])
    }
    answersByQuery.get(answer.queryId)!.push(answer)
  })

  const presenceCount = context.queries.filter(q => {
    const answers = answersByQuery.get(q.id) || []
    return answers.some(a => a.presence)
  }).length

  const visibilityPct = context.queries.length > 0 
    ? (presenceCount / context.queries.length) * 100 
    : 0

  // If visibility is excellent (>80%), provide maintenance recommendations
  if (visibilityPct >= 80) {
    recommendations.push({
      id: 'maintain-excellence',
      type: 'rank_improvement',
      priority: 'low',
      title: `Excellent GEO Performance (${visibilityPct.toFixed(0)}% visibility)`,
      description: `You're ranking #1 on ${presenceCount} out of ${context.queries.length} queries. Focus on maintaining this dominance and expanding to new query opportunities.`,
      keywords: [],
      impact: {
        score: 40,
        reason: 'Maintain current excellent performance',
      },
      actionItems: [
        'Monitor competitor activity weekly - defend your rankings',
        'Refresh content quarterly to stay current',
        'Expand query coverage to new amenity combinations',
        'Build more backlinks to maintain authority',
        'Update property information when features change',
      ],
      relatedQueries: context.queries.slice(0, 3).map(q => ({
        id: q.id,
        text: q.text,
        type: q.type,
      })),
    })

    // Suggest expanding query coverage
    recommendations.push({
      id: 'expand-coverage',
      type: 'missing_keyword',
      priority: 'low',
      title: 'Expand Query Coverage',
      description: 'Consider adding more specific queries targeting niche amenities, lifestyle personas, or micro-locations to capture additional search traffic.',
      keywords: ['expansion opportunity'],
      impact: {
        score: 45,
        reason: 'Capture additional search segments',
      },
      actionItems: [
        'Add queries for unique property features not yet tracked',
        'Target specific demographic personas (young professionals, families, etc.)',
        'Create queries for nearby landmarks or employers',
        'Add seasonal amenity queries (heated pool, fire pits, etc.)',
      ],
      relatedQueries: [],
    })
  }

  // Always recommend citation building
  if (context.competitors.length > 0) {
    const topCompetitor = context.competitors[0]
    
    recommendations.push({
      id: 'build-citations',
      type: 'citation_opportunity',
      priority: 'low',
      title: 'Continue Building Authority',
      description: `While you're ranking well, building more citations on high-authority domains will strengthen your position against competitors like ${topCompetitor.name}.`,
      keywords: [],
      competitorContext: {
        competitorName: topCompetitor.name,
        competitorDomain: topCompetitor.domain,
        avgRank: topCompetitor.avgRank,
      },
      impact: {
        score: 50,
        reason: 'Strengthen position defensively',
      },
      actionItems: [
        'Submit to apartment directory sites (ApartmentList, ForRent.com)',
        'Get featured in local San Diego real estate publications',
        'Build partnerships with local businesses for cross-promotion',
        'Encourage resident reviews on multiple platforms',
      ],
      relatedQueries: [],
    })
  }

  return recommendations
}

function generateSummary(recommendations: ContentRecommendation[]): RecommendationSummary {
  return {
    totalRecommendations: recommendations.length,
    highPriority: recommendations.filter(r => r.priority === 'high').length,
    mediumPriority: recommendations.filter(r => r.priority === 'medium').length,
    lowPriority: recommendations.filter(r => r.priority === 'low').length,
    categories: {
      missingKeywords: recommendations.filter(r => r.type === 'missing_keyword').length,
      contentGaps: recommendations.filter(r => r.type === 'content_gap').length,
      citationOpportunities: recommendations.filter(r => r.type === 'citation_opportunity').length,
      rankImprovement: recommendations.filter(r => r.type === 'rank_improvement').length,
      voiceSearch: recommendations.filter(r => r.type === 'voice_search').length,
    },
  }
}

function pageTypeToTargetPageType(pageType: PublicSitePageType): string {
  switch (pageType) {
    case 'floorplans':
      return 'floorplans_or_pricing_page'
    case 'amenities':
      return 'amenities_page'
    case 'neighborhood':
      return 'local_landing_page'
    case 'faq':
      return 'faq_or_support_page'
    case 'contact':
      return 'contact_or_tour_page'
    case 'gallery':
      return 'gallery_page'
    case 'pet_policy':
      return 'pet_policy_page'
    case 'specials':
      return 'specials_page'
    case 'tour':
      return 'tour_booking_page'
    case 'home':
      return 'homepage'
    default:
      return 'category_or_feature_page'
  }
}

function inferTargetPageTypes(recommendation: ContentRecommendation): PublicSitePageType[] {
  if (recommendation.type === 'citation_opportunity') return []
  const primaryType = recommendation.relatedQueries[0]?.type
  const combinedText = `${recommendation.title} ${recommendation.description} ${recommendation.keywords.join(' ')}`.toLowerCase()

  if (primaryType === 'comparison') return ['neighborhood', 'home']
  if (primaryType === 'local') return ['neighborhood', 'home']
  if (primaryType === 'faq' || recommendation.type === 'voice_search') return ['faq', 'home']
  if (primaryType === 'branded') return ['home', 'contact']
  if (primaryType === 'category') return ['amenities', 'floorplans', 'home']

  if (recommendation.id === 'site-audit-discoverability') return ['home']
  if (/structured data|schema|answer block/.test(combinedText)) return ['faq', 'home']
  if (/floor|pricing|rent|availability|apartment/.test(combinedText)) return ['floorplans', 'faq']
  if (/amenit|feature/.test(combinedText)) return ['amenities']
  if (/pet|dog|cat/.test(combinedText)) return ['pet_policy', 'faq']
  if (/special|concession|offer/.test(combinedText)) return ['specials', 'floorplans']
  if (/tour|schedule|contact/.test(combinedText)) return ['tour', 'contact']

  if (recommendation.type === 'rank_improvement') return ['home', 'amenities', 'floorplans']
  return ['home']
}

function suggestedPathForPageType(pageType: PublicSitePageType): string {
  switch (pageType) {
    case 'floorplans':
      return '/floorplans'
    case 'amenities':
      return '/amenities'
    case 'neighborhood':
      return '/neighborhood'
    case 'faq':
      return '/faq'
    case 'contact':
      return '/contact'
    case 'gallery':
      return '/gallery'
    case 'pet_policy':
      return '/pet-policy'
    case 'specials':
      return '/specials'
    case 'tour':
      return '/schedule-a-tour'
    default:
      return '/'
  }
}

function findTargetPage(
  recommendation: ContentRecommendation,
  context: AnalysisContext
): { page: PublicSitePageAudit | null; suggestedUrl: string | null; expectedPageType: PublicSitePageType | null } {
  const pages = context.siteAudit.pages || []
  const reachablePages = pages.filter(page => page.reachable)
  const preferredTypes = inferTargetPageTypes(recommendation)
  const exactMatch = preferredTypes
    .map(pageType => ({ pageType, page: reachablePages.find(page => page.pageType === pageType) || null }))
    .find(match => Boolean(match.page)) || null
  const exactPage = exactMatch?.page || null
  const fallbackPage = reachablePages.find(page => page.pageType === 'home') || reachablePages[0] || null
  const expectedPageType = exactMatch?.pageType || preferredTypes[0] || null

  if (exactPage) return { page: exactPage, suggestedUrl: null, expectedPageType }
  if (!context.siteAudit.normalizedOrigin || !expectedPageType) {
    return { page: fallbackPage, suggestedUrl: null, expectedPageType }
  }

  const suggestedUrl = new URL(suggestedPathForPageType(expectedPageType), context.siteAudit.normalizedOrigin).toString()
  return { page: fallbackPage, suggestedUrl, expectedPageType }
}

function inferTargetPageType(recommendation: ContentRecommendation): string {
  const primaryType = recommendation.relatedQueries[0]?.type
  const expectedPageType = inferTargetPageTypes(recommendation)[0]
  if (expectedPageType) return pageTypeToTargetPageType(expectedPageType)
  if (recommendation.type === 'citation_opportunity') return 'third_party_listing'
  if (primaryType === 'comparison') return 'comparison_page'
  if (primaryType === 'local') return 'local_landing_page'
  if (primaryType === 'faq' || recommendation.type === 'voice_search') return 'faq_or_support_page'
  if (recommendation.type === 'rank_improvement') return 'existing_owned_page'
  return 'category_or_feature_page'
}

function inferAccessLevel(recommendation: ContentRecommendation): RecommendationAccessLevel {
  if (recommendation.type === 'citation_opportunity') return 'ThirdParty'
  const combinedText = [
    recommendation.title,
    recommendation.description,
    ...recommendation.keywords,
    ...(recommendation.missingSignals || []),
    ...(recommendation.implementationSteps || []),
  ].join(' ')
  if (/schema|json-ld|robots|sitemap|llms\.txt|canonical|structured data/i.test(combinedText)) return 'CodeRequired'
  if (recommendation.type === 'voice_search') return 'CMSOrEditor'
  return recommendation.keywords.some(keyword => /schema|robots|sitemap|llms\.txt/i.test(keyword))
    ? 'CodeRequired'
    : 'CMSOrEditor'
}

function inferOwner(recommendation: ContentRecommendation): RecommendationOwner {
  if (recommendation.accessLevel === 'ThirdParty') return 'partnerships'
  if (recommendation.accessLevel === 'CodeRequired') return 'engineering'
  if (recommendation.type === 'missing_keyword' || recommendation.type === 'content_gap') return 'content'
  return 'seo'
}

function inferTargetUrl(recommendation: ContentRecommendation, context: AnalysisContext): string | null {
  if (!context.siteAudit.normalizedOrigin) return null
  if (recommendation.accessLevel === 'ThirdParty') return null
  const target = findTargetPage(recommendation, context)
  return target.suggestedUrl || target.page?.url || context.siteAudit.normalizedOrigin
}

function buildSourceQueryEvidence(
  recommendation: ContentRecommendation,
  relatedAnswers: AnalysisContext['answers'],
  context: AnalysisContext
): string[] {
  return recommendation.relatedQueries.flatMap(query => {
    const answers = relatedAnswers.filter(answer => answer.queryId === query.id)
    if (answers.length === 0) return [`Tracked prompt: "${query.text}" (${query.type}).`]
    return answers.map(answer => {
      const surface = context.runsBySurface.get(answer.runId)
      const label = surface ? getSurfaceLabel(surface) : 'Unknown surface'
      if (!answer.presence) return `"${query.text}" is absent on ${label}.`
      return `"${query.text}" is present on ${label}${answer.llmRank ? ` at rank #${answer.llmRank}` : ''}.`
    })
  }).slice(0, 6)
}

function buildCrawlEvidence(
  recommendation: ContentRecommendation,
  context: AnalysisContext,
  targetPage: PublicSitePageAudit | null,
  suggestedUrl: string | null,
  expectedPageType: PublicSitePageType | null
): string[] {
  const evidence = [...(recommendation.evidence || [])]
  const siteAudit = context.siteAudit

  if (siteAudit.crawlSummary) {
    evidence.push(
      `URL-only crawl audited ${siteAudit.crawlSummary.pagesAudited}/${siteAudit.crawlSummary.pagesAttempted} discovered page(s).`
    )
  }
  if (targetPage) {
    evidence.push(
      `Target page ${targetPage.url} is classified as ${targetPage.pageType} with ${targetPage.wordCount} words, ${targetPage.structuredDataTypes.length || 'no'} schema type(s), and ${targetPage.answerBlockSignals} answer-block signal(s).`
    )
    targetPage.evidenceSnippets.slice(0, 2).forEach(snippet => evidence.push(`Page snippet: ${snippet}`))
  } else if (suggestedUrl && expectedPageType) {
    evidence.push(`No reachable ${expectedPageType.replace('_', ' ')} page was found; suggested target is ${suggestedUrl}.`)
  }

  return Array.from(new Set(evidence)).slice(0, 8)
}

function buildMissingSignals(
  recommendation: ContentRecommendation,
  targetPage: PublicSitePageAudit | null,
  expectedPageType: PublicSitePageType | null
): string[] {
  const missing = new Set(recommendation.missingSignals || [])
  if (expectedPageType && (!targetPage || targetPage.pageType !== expectedPageType)) {
    missing.add(`reachable ${expectedPageType.replace('_', ' ')} page`)
  }
  if (targetPage) {
    if (!targetPage.metaDescription) missing.add('meta description')
    if (targetPage.wordCount < 250) missing.add('substantive page copy')
    if (targetPage.answerBlockSignals === 0 && (expectedPageType === 'faq' || recommendation.type === 'voice_search')) {
      missing.add('answer-first FAQ blocks')
    }
    if (targetPage.structuredDataTypes.length === 0 && /schema|structured data|FAQ|Organization/i.test(`${recommendation.title} ${recommendation.description}`)) {
      missing.add('JSON-LD structured data')
    }
  }
  return Array.from(missing)
}

function buildImplementationSteps(
  recommendation: ContentRecommendation,
  targetPage: PublicSitePageAudit | null,
  suggestedUrl: string | null,
  expectedPageType: PublicSitePageType | null
): string[] {
  if (recommendation.implementationSteps?.length) return recommendation.implementationSteps

  const targetLabel = suggestedUrl || targetPage?.url || 'the target page'
  const steps = new Set<string>()
  if (suggestedUrl && expectedPageType) {
    steps.add(`Create a public ${expectedPageType.replace('_', ' ')} page at ${suggestedUrl}.`)
    steps.add('Add the page to sitemap.xml and internal navigation.')
  } else {
    steps.add(`Update ${targetLabel} with copy that directly answers the related GEO prompt(s).`)
  }
  recommendation.actionItems.forEach(item => steps.add(item))
  if (recommendation.accessLevel === 'CodeRequired' || /schema|structured data|FAQ|Organization/i.test(`${recommendation.title} ${recommendation.description}`)) {
    steps.add('Add or update JSON-LD schema that matches the visible page content.')
  }
  steps.add('Use concise answer-first sections before longer marketing copy.')
  return Array.from(steps).slice(0, 6)
}

function buildAcceptanceCriteria(
  recommendation: ContentRecommendation,
  targetPage: PublicSitePageAudit | null,
  suggestedUrl: string | null,
  expectedPageType: PublicSitePageType | null
): string[] {
  if (recommendation.acceptanceCriteria?.length) return recommendation.acceptanceCriteria

  const targetLabel = suggestedUrl || targetPage?.url || 'the target page'
  const criteria = new Set<string>()
  criteria.add(`${targetLabel} returns HTTP 200 and is linked from sitemap.xml or site navigation.`)
  if (expectedPageType) {
    criteria.add(`The URL-only crawl classifies the page as ${expectedPageType.replace('_', ' ')}.`)
  }
  criteria.add('The page includes direct answer blocks for the related GEO prompt(s).')
  if (recommendation.accessLevel === 'CodeRequired' || /schema|structured data|FAQ|Organization/i.test(`${recommendation.title} ${recommendation.description}`)) {
    criteria.add('Relevant JSON-LD validates without parse errors.')
  }
  criteria.add('After rerunning PropertyAudit, the recommendation evidence updates against the new page signals.')
  return Array.from(criteria).slice(0, 6)
}

function enrichRecommendation(
  recommendation: ContentRecommendation,
  context: AnalysisContext
): ContentRecommendation {
  const relatedAnswers = recommendation.relatedQueries.flatMap(query =>
    context.answers.filter(answer => answer.queryId === query.id)
  )
  const accessLevel = inferAccessLevel(recommendation)
  const target = findTargetPage({ ...recommendation, accessLevel }, context)
  const targetPageType = recommendation.targetPageType ||
    (target.expectedPageType ? pageTypeToTargetPageType(target.expectedPageType) : inferTargetPageType(recommendation))
  const enrichedTargetUrl = recommendation.targetUrl ?? inferTargetUrl({ ...recommendation, accessLevel }, context)
  const sourceQueryEvidence = recommendation.sourceQueryEvidence ||
    buildSourceQueryEvidence(recommendation, relatedAnswers, context)
  const crawlEvidence = buildCrawlEvidence(
    recommendation,
    context,
    target.page,
    target.suggestedUrl,
    target.expectedPageType
  )
  const missingSignals = buildMissingSignals(recommendation, target.page, target.expectedPageType)

  return {
    ...recommendation,
    accessLevel,
    owner: inferOwner({ ...recommendation, accessLevel }),
    status: recommendation.status || 'todo',
    targetPageType,
    targetUrl: enrichedTargetUrl,
    evidenceMode: context.siteAudit.websiteUrl ? 'URLOnly' : undefined,
    evidence: crawlEvidence,
    implementationSteps: buildImplementationSteps({ ...recommendation, accessLevel }, target.page, target.suggestedUrl, target.expectedPageType),
    acceptanceCriteria: buildAcceptanceCriteria({ ...recommendation, accessLevel }, target.page, target.suggestedUrl, target.expectedPageType),
    detectedOnUrls: recommendation.detectedOnUrls ||
      [target.page?.url, ...(context.siteAudit.pages || []).filter(page => page.reachable).map(page => page.url).slice(0, 3)]
        .filter(Boolean) as string[],
    missingSignals,
    sourceQueryEvidence,
    surfaceBreakdown:
      recommendation.surfaceBreakdown ||
      (relatedAnswers.length > 0 ? buildSurfaceBreakdown(relatedAnswers, context.runsBySurface) : undefined),
  }
}
