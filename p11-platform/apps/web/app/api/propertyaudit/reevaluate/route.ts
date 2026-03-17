/**
 * PropertyAudit Re-evaluate API
 * Re-evaluates existing run answers with updated evaluator logic
 * Useful when evaluator improvements are made
 */

import { NextRequest, NextResponse } from 'next/server'
import type { Json } from '@/types/supabase'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { AnswerBlockSchema, scoreAnswer, aggregateScores, type ScoredAnswer } from '@/utils/propertyaudit'

function normalizeAnswerBlock(
  orderedEntities: unknown,
  citations: Array<{ url: string; domain: string; entity_ref: string }>,
  answerSummary: string | null
) {
  const candidate = {
    ordered_entities: Array.isArray(orderedEntities) ? orderedEntities : [],
    citations: citations.map((citation) => ({
      url: citation.url,
      domain: citation.domain,
      entity_ref: citation.entity_ref || '',
    })),
    answer_summary: answerSummary || '',
    notes: { flags: [] as const },
  }

  const parsed = AnswerBlockSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

// POST: Re-evaluate a specific run
export async function POST(req: NextRequest) {
  try {
    const supabaseAuth = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { runId } = body

    if (!runId) {
      return NextResponse.json({ error: 'runId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Get the run with all answers
    const { data: run, error: runError } = await supabase
      .from('geo_runs')
      .select(`
        *,
        geo_answers (
          id,
          query_id,
          answer_summary,
          ordered_entities,
          raw_json
        )
      `)
      .eq('id', runId)
      .single()

    if (runError || !run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, run.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get property for brand context
    const { data: property } = await supabase
      .from('properties')
      .select('name')
      .eq('id', run.property_id)
      .single()

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    // Get property config
    const { data: config } = await supabase
      .from('geo_property_config')
      .select('domains, competitor_domains')
      .eq('property_id', run.property_id)
      .single()

    // Build brand context
    const brandName = property.name
    const brandDomains = config?.domains || []
    const competitors = config?.competitor_domains || []

    const evaluationContext = {
      brandName,
      brandDomains,
      competitors
    }

    console.log(`[reevaluate] Re-evaluating run ${runId} for ${brandName}`)
    console.log(`[reevaluate] Brand domains: [${brandDomains.join(', ')}]`)

    const results: ScoredAnswer[] = []
    const answers = run.geo_answers || []
    const answerIds = answers.map((a: { id: string }) => a.id)

    const { data: citationsRows } = await supabase
      .from('geo_citations')
      .select('answer_id, url, domain, entity_ref')
      .in('answer_id', answerIds)

    const citationsByAnswer = new Map<string, Array<{ url: string; domain: string; entity_ref: string }>>()
    for (const row of citationsRows || []) {
      if (!citationsByAnswer.has(row.answer_id)) {
        citationsByAnswer.set(row.answer_id, [])
      }
      citationsByAnswer.get(row.answer_id)?.push({
        url: row.url,
        domain: row.domain,
        entity_ref: row.entity_ref ?? '',
      })
    }

    // Re-evaluate each answer
    for (const answer of answers) {
      try {
        // Reconstruct AnswerBlock from stored data
        const answerBlock = normalizeAnswerBlock(
          answer.ordered_entities,
          citationsByAnswer.get(answer.id) || [],
          answer.answer_summary
        )

        if (!answerBlock) {
          console.warn(`Skipping answer ${answer.id}: invalid answer shape`)
          continue
        }

        // Re-score with updated evaluator
        const scoredAnswer = scoreAnswer(answerBlock, evaluationContext)
        results.push(scoredAnswer)

        // Update answer in database
        await supabase
          .from('geo_answers')
          .update({
            presence: scoredAnswer.presence,
            llm_rank: scoredAnswer.llmRank,
            link_rank: scoredAnswer.linkRank,
            sov: scoredAnswer.sov,
            flags: scoredAnswer.flags
          })
          .eq('id', answer.id)
      } catch (error) {
        console.error(`Error re-evaluating answer ${answer.id}:`, error)
      }
    }

    // Recalculate aggregate scores
    const aggregate = aggregateScores(results)

    // Build score breakdown
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
    const breakdownJson = breakdown as unknown as Json
    const queryScoresJson = results.map(r => ({
      score: r.score,
      presence: r.presence,
      breakdown: r.breakdown
    })) as unknown as Json

    // Update or create score
    const { data: existingScore } = await supabase
      .from('geo_scores')
      .select('id')
      .eq('run_id', runId)
      .single()

    if (existingScore) {
      // Update existing score
      await supabase
        .from('geo_scores')
        .update({
          overall_score: aggregate.overallScore,
          visibility_pct: aggregate.visibilityPct,
          avg_llm_rank: aggregate.avgLlmRank,
          avg_link_rank: aggregate.avgLinkRank,
          avg_sov: aggregate.avgSov,
          breakdown: breakdownJson,
          query_scores: queryScoresJson
        })
        .eq('id', existingScore.id)
    } else {
      // Insert new score
      await supabase
        .from('geo_scores')
        .insert({
          run_id: runId,
          overall_score: aggregate.overallScore,
          visibility_pct: aggregate.visibilityPct,
          avg_llm_rank: aggregate.avgLlmRank,
          avg_link_rank: aggregate.avgLinkRank,
          avg_sov: aggregate.avgSov,
          breakdown: breakdownJson,
          query_scores: queryScoresJson
        })
    }

    console.log(`[reevaluate] Complete: ${results.length} answers, score: ${aggregate.overallScore.toFixed(1)}`)

    return NextResponse.json({
      success: true,
      runId,
      reevaluated: results.length,
      score: aggregate.overallScore,
      visibility: aggregate.visibilityPct,
      avgLlmRank: aggregate.avgLlmRank,
      brandDomains
    })
  } catch (error) {
    console.error('PropertyAudit Re-evaluate Error:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
