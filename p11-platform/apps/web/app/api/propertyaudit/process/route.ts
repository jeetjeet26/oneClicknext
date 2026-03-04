/**
 * PropertyAudit Process API
 * Executes GEO audit runs by calling LLM connectors
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { OpenAIConnector } from '@/utils/propertyaudit/openai-connector'
import { ClaudeConnector } from '@/utils/propertyaudit/claude-connector'
import { OpenAINaturalConnector } from '@/utils/propertyaudit/openai-natural-connector'
import { ClaudeNaturalConnector } from '@/utils/propertyaudit/claude-natural-connector'
import { scoreAnswer, aggregateScores, type ConnectorContext, type ScoredAnswer, type WebSearchSource, type AnswerEntity } from '@/utils/propertyaudit'

/**
 * Extract citations from web search sources by matching domains to entities
 * This creates citations for sources that match entities mentioned in the response
 */
function extractCitationsFromSources(
  searchSources: WebSearchSource[],
  entities: AnswerEntity[],
  brandDomains: string[]
): Array<{ url: string; domain: string; entity_ref: string; is_brand_domain: boolean }> {
  if (!searchSources || searchSources.length === 0) {
    return []
  }

  const citations: Array<{ url: string; domain: string; entity_ref: string; is_brand_domain: boolean }> = []
  const addedUrls = new Set<string>()

  // For each search source, try to match it to an entity
  for (const source of searchSources) {
    if (addedUrls.has(source.url)) continue

    const sourceDomainLower = source.domain.toLowerCase().replace(/^www\./, '')
    
    // Check if this source matches any entity by domain
    let matchedEntity: AnswerEntity | null = null
    for (const entity of entities) {
      const entityDomainLower = (entity.domain || '').toLowerCase().replace(/^www\./, '')
      
      // Match by domain
      if (entityDomainLower && sourceDomainLower.includes(entityDomainLower)) {
        matchedEntity = entity
        break
      }
      
      // Match by entity name appearing in source title or URL
      const entityNameLower = entity.name.toLowerCase()
      if (
        source.title.toLowerCase().includes(entityNameLower) ||
        source.url.toLowerCase().includes(entityNameLower.replace(/\s+/g, ''))
      ) {
        matchedEntity = entity
        break
      }
    }

    // Check if it's a brand domain
    const isBrandDomain = brandDomains.some(bd => 
      sourceDomainLower.includes(bd.replace(/^www\./, '').toLowerCase())
    )

    // Add citation if we found a match or it's a brand domain
    if (matchedEntity || isBrandDomain) {
      citations.push({
        url: source.url,
        domain: source.domain,
        entity_ref: matchedEntity?.name || '',
        is_brand_domain: isBrandDomain
      })
      addedUrls.add(source.url)
    }
  }

  // Also add all sources as citations (even without entity match) for better tracking
  // This ensures we capture all sources the LLM had access to
  for (const source of searchSources) {
    if (addedUrls.has(source.url)) continue
    
    const sourceDomainLower = source.domain.toLowerCase().replace(/^www\./, '')
    const isBrandDomain = brandDomains.some(bd => 
      sourceDomainLower.includes(bd.replace(/^www\./, '').toLowerCase())
    )
    
    citations.push({
      url: source.url,
      domain: source.domain,
      entity_ref: '',
      is_brand_domain: isBrandDomain
    })
    addedUrls.add(source.url)
  }

  return citations
}

/**
 * Infer domain from property name
 * Common property management companies and their domains
 */
function inferDomainFromName(name: string): string | null {
  const lowerName = name.toLowerCase()
  
  // Common property management companies
  const companyDomains: Record<string, string> = {
    'amli': 'amli.com',
    'avalon': 'avaloncommunities.com',
    'greystar': 'greystar.com',
    'essex': 'essexapartmenthomes.com',
    'equity': 'equityapartments.com',
    'camden': 'camdenliving.com',
    'bozzuto': 'bozzuto.com',
    'gables': 'gables.com',
    'cortland': 'cortland.com',
    'lincoln': 'lincolnapts.com',
  }
  
  for (const [key, domain] of Object.entries(companyDomains)) {
    if (lowerName.includes(key)) {
      return domain
    }
  }
  
  return null
}

// POST: Process a queued run
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { runId } = body

    if (!runId) {
      return NextResponse.json({ error: 'runId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Get the run
    const { data: run, error: runError } = await supabase
      .from('geo_runs')
      .select('*')
      .eq('id', runId)
      .single()

    if (runError || !run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    if (run.status !== 'queued') {
      return NextResponse.json({ error: 'Run is not in queued state' }, { status: 400 })
    }

    // Update status to running and set web search flag
    const enableWebSearch = process.env.GEO_ENABLE_WEB_SEARCH === 'true'
    await supabase
      .from('geo_runs')
      .update({ 
        status: 'running',
        uses_web_search: enableWebSearch
      })
      .eq('id', runId)

    // Get queries for the property
    const { data: queries, error: queriesError } = await supabase
      .from('geo_queries')
      .select('*')
      .eq('property_id', run.property_id)
      .eq('is_active', true)

    if (queriesError || !queries || queries.length === 0) {
      await supabase
        .from('geo_runs')
        .update({ 
          status: 'failed', 
          error_message: 'No active queries found',
          finished_at: new Date().toISOString()
        })
        .eq('id', runId)
      return NextResponse.json({ error: 'No active queries found' }, { status: 400 })
    }

    // Get property for brand context with full location details
    const { data: property } = await supabase
      .from('properties')
      .select('name, address, website_url')
      .eq('id', run.property_id)
      .single()

    if (!property) {
      await supabase
        .from('geo_runs')
        .update({ 
          status: 'failed', 
          error_message: 'Property not found',
          finished_at: new Date().toISOString()
        })
        .eq('id', runId)
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    // Extract location details from JSONB address
    const address = property.address as { city?: string; state?: string; street?: string; zip?: string } | null
    const propertyLocation = {
      city: address?.city || '',
      state: address?.state || '',
      fullAddress: [address?.street, address?.city, address?.state, address?.zip]
        .filter(Boolean)
        .join(', '),
      websiteUrl: property.website_url || ''
    }

    console.log(`[geo] Property location context: ${propertyLocation.city}, ${propertyLocation.state}`)

    // Get property config for domains
    let { data: config } = await supabase
      .from('geo_property_config')
      .select('domains, competitor_domains')
      .eq('property_id', run.property_id)
      .single()

    // Auto-create config if it doesn't exist
    if (!config) {
      console.log(`[geo] No config found for property ${run.property_id}, creating default config`)
      
      // Try to infer domain from property name
      const inferredDomain = inferDomainFromName(property.name)
      
      const { data: newConfig, error: createError } = await supabase
        .from('geo_property_config')
        .insert({
          property_id: run.property_id,
          domains: inferredDomain ? [inferredDomain] : [],
          competitor_domains: [],
          is_active: true
        })
        .select()
        .single()

      if (!createError && newConfig) {
        config = newConfig
        console.log(`[geo] Created config with domain: ${inferredDomain || 'none'}`)
      }
    }

    // Build brand context
    const brandName = property.name
    const brandDomains = config?.domains || []
    const competitors = config?.competitor_domains || []

    console.log(`[geo] Brand context: name="${brandName}", domains=[${brandDomains.join(', ')}]`)
    console.log(`[geo] Web search: ${enableWebSearch ? 'enabled' : 'disabled'}`)

    const auditModeRaw = (process.env.GEO_AUDIT_MODE || 'structured').toLowerCase()
    const auditMode = auditModeRaw === 'natural' ? 'natural' : 'structured'
    console.log(`[geo] Audit mode: ${auditMode}`)

    // Get connectors
    const structuredConnector =
      run.surface === 'openai' ? new OpenAIConnector() : new ClaudeConnector()
    const naturalConnector =
      run.surface === 'openai' ? new OpenAINaturalConnector() : new ClaudeNaturalConnector()

    const results: ScoredAnswer[] = []
    const errors: string[] = []

    // Process each query (respect per-query run_count)
    for (const query of queries) {
      const runCount = Math.max(1, Number(query.run_count || 1))
      for (let attempt = 0; attempt < runCount; attempt += 1) {
        try {
          const context: ConnectorContext = {
            queryId: query.id,
            queryText: query.text,
            brandName,
            brandDomains,
            competitors,
            propertyLocation
          }

          let answer = null as any
          let raw: unknown = null
          let naturalResponseText: string | null = null
          let analysisMethod: string = 'structured'
          let searchSources: WebSearchSource[] = []

          if (auditMode === 'natural') {
            analysisMethod = 'natural_two_phase'

          // Phase 1: Natural response (no property context is provided to the model)
          const natural = await naturalConnector.getNaturalResponse(context.queryText)
          naturalResponseText = natural.text
          searchSources = natural.searchSources || []

          // Phase 2: Analyze response and extract structured GEO fields
          const analyzed = await naturalConnector.analyzeResponse({
            naturalResponse: natural.text,
            brandName: context.brandName,
            queryText: context.queryText,
            expectedCity: context.propertyLocation?.city,
            expectedState: context.propertyLocation?.state,
            brandDomains: context.brandDomains,
            competitors: context.competitors,
          })

            answer = analyzed.envelope.answer_block
            raw = {
              audit_mode: auditMode,
              phase1: natural.rawResponse,
              phase2: analyzed.raw,
              analysis: analyzed.envelope.analysis,
              searchSources: searchSources, // Store for reference
            }
            
            console.log(`[geo] Query "${context.queryText.slice(0, 50)}..." - ${searchSources.length} web sources found`)
          } else {
            const structured = await structuredConnector.invoke(context)
            answer = structured.answer
            raw = structured.raw
          }

          // Score the answer
          const scoredAnswer = scoreAnswer(answer, {
            brandName,
            brandDomains,
            competitors
          })

          results.push(scoredAnswer)

          // Insert answer
          const { data: insertedAnswer, error: answerError } = await supabase
            .from('geo_answers')
            .insert({
              run_id: runId,
              query_id: query.id,
              presence: scoredAnswer.presence,
              llm_rank: scoredAnswer.llmRank,
              link_rank: scoredAnswer.linkRank,
              sov: scoredAnswer.sov,
              flags: scoredAnswer.flags,
              answer_summary: answer.answer_summary,
              ordered_entities: answer.ordered_entities,
              raw_json: raw,
              natural_response: naturalResponseText,
              analysis_method: analysisMethod
            })
            .select()
            .single()

          if (answerError) {
            console.error('Error inserting answer:', answerError)
            continue
          }

          // Insert citations - combine LLM-extracted citations with web search sources
          const llmCitations = answer.citations.map((citation: { url: string; domain: string; entity_ref?: string }) => ({
            answer_id: insertedAnswer.id,
            url: citation.url,
            domain: citation.domain,
            is_brand_domain: brandDomains.some((bd: string) => 
              citation.domain.includes(bd.replace(/^www\./, ''))
            ),
            entity_ref: citation.entity_ref || null
          }))

        // Extract citations from web search sources by matching to entities
          const webSearchCitations = extractCitationsFromSources(
            searchSources,
            answer.ordered_entities || [],
            brandDomains
          ).map(citation => ({
            answer_id: insertedAnswer.id,
            url: citation.url,
            domain: citation.domain,
            is_brand_domain: citation.is_brand_domain,
            entity_ref: citation.entity_ref || null
          }))

        // Combine and dedupe by URL
          const allCitations = [...llmCitations]
          const existingUrls = new Set(llmCitations.map((c: { url: string }) => c.url))
          for (const wsCitation of webSearchCitations) {
            if (!existingUrls.has(wsCitation.url)) {
              allCitations.push(wsCitation)
              existingUrls.add(wsCitation.url)
            }
          }

          if (allCitations.length > 0) {
            console.log(`[geo] Inserting ${allCitations.length} citations (${llmCitations.length} from LLM, ${webSearchCitations.length} from web search)`)
            await supabase
              .from('geo_citations')
              .insert(allCitations)
          }
        } catch (error) {
          console.error(`Error processing query ${query.id}:`, error)
          errors.push(`Query ${query.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }
    }

    // Calculate aggregate scores
    const aggregate = aggregateScores(results)

    // Build score breakdown from results
    const breakdownTotals = results.reduce((acc, r) => ({
      position: acc.position + (r.breakdown?.position || 0),
      link: acc.link + (r.breakdown?.link || 0),
      sov: acc.sov + (r.breakdown?.sov || 0),
      accuracy: acc.accuracy + (r.breakdown?.accuracy || 0)
    }), { position: 0, link: 0, sov: 0, accuracy: 0 })

    const breakdown = results.length > 0 ? {
      position: breakdownTotals.position / results.length,
      link: breakdownTotals.link / results.length,
      sov: breakdownTotals.sov / results.length,
      accuracy: breakdownTotals.accuracy / results.length
    } : { position: 0, link: 0, sov: 0, accuracy: 0 }

    // Insert score
    await supabase
      .from('geo_scores')
      .insert({
        run_id: runId,
        overall_score: aggregate.overallScore,
        visibility_pct: aggregate.visibilityPct,
        avg_llm_rank: aggregate.avgLlmRank,
        avg_link_rank: aggregate.avgLinkRank,
        avg_sov: aggregate.avgSov,
        breakdown,
        query_scores: results.map(r => ({
          score: r.score,
          presence: r.presence,
          breakdown: r.breakdown
        }))
      })

    // Update run status
    const finalStatus = errors.length > 0 && results.length === 0 ? 'failed' : 'completed'
    await supabase
      .from('geo_runs')
      .update({
        status: finalStatus,
        finished_at: new Date().toISOString(),
        error_message: errors.length > 0 ? errors.join('; ') : null
      })
      .eq('id', runId)

    return NextResponse.json({
      success: true,
      runId,
      processed: results.length,
      errors: errors.length,
      score: aggregate.overallScore,
      visibility: aggregate.visibilityPct
    })
  } catch (error) {
    console.error('PropertyAudit Process Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

