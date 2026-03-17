/**
 * LeadPulse Score API
 * Calculate and retrieve lead scores
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  badRequest,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

type ScoreRpcResult = { leadId: string; scoreId: unknown; error: unknown }

function summarizeScoreResults(
  results: PromiseSettledResult<ScoreRpcResult>[]
): { successful: number; failed: number } {
  let successful = 0
  let failed = 0

  for (const result of results) {
    if (result.status === 'rejected') {
      failed += 1
      continue
    }

    if (result.value.error) {
      failed += 1
    } else {
      successful += 1
    }
  }

  return { successful, failed }
}

export interface LeadScore {
  id: string
  leadId: string
  totalScore: number
  engagementScore: number
  timingScore: number
  sourceScore: number
  completenessScore: number
  behaviorScore: number
  scoreBucket: 'hot' | 'warm' | 'cold' | 'unqualified'
  factors: ScoreFactor[]
  workflowOutcomes?: {
    workflowStatus: string | null
    pending: number
    sent: number
    skipped: number
    failed: number
    retried: number
    nextActionAt: string | null
    lastActionAt: string | null
  }
  scoredAt: string
  modelVersion: string
}

export interface ScoreFactor {
  factor: string
  impact: string
  type: 'positive' | 'negative' | 'neutral'
}

type WorkflowActionAttempt = {
  step_number: number
  status: string | null
  created_at: string | null
}

type WorkflowOutcomes = NonNullable<LeadScore['workflowOutcomes']>

async function getWorkflowOutcomesForLead(leadId: string): Promise<WorkflowOutcomes | null> {
  const serviceClient = createServiceClient()
  const { data: workflow, error } = await serviceClient
    .from('lead_workflows')
    .select(`
      status,
      next_action_at,
      last_action_at,
      workflow:workflow_definitions(steps),
      actions:workflow_actions(
        step_number,
        status,
        created_at
      )
    `)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !workflow) {
    return null
  }

  const actions = (workflow.actions as WorkflowActionAttempt[] | null) || []
  const steps = Array.isArray(workflow.workflow?.steps) ? workflow.workflow.steps : []

  const attemptsByStep = new Map<number, WorkflowActionAttempt[]>()
  for (const attempt of actions) {
    if (!Number.isInteger(attempt.step_number)) continue
    const existing = attemptsByStep.get(attempt.step_number) || []
    existing.push(attempt)
    attemptsByStep.set(attempt.step_number, existing)
  }

  let sent = 0
  let skipped = 0
  let failed = 0
  let retried = 0
  let completed = 0

  for (let stepNumber = 0; stepNumber < steps.length; stepNumber++) {
    const attempts = attemptsByStep.get(stepNumber) || []
    if (attempts.length === 0) continue
    if (attempts.length > 1) {
      retried += 1
    }
    const latest = attempts.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))[attempts.length - 1]
    if (!latest) continue

    if (latest.status === 'sent') {
      sent += 1
      completed += 1
    } else if (latest.status === 'skipped') {
      skipped += 1
      completed += 1
    } else if (latest.status === 'failed') {
      failed += 1
    }
  }

  const pending = Math.max(steps.length - completed - failed, 0)

  return {
    workflowStatus: (workflow.status as string | null) || null,
    pending,
    sent,
    skipped,
    failed,
    retried,
    nextActionAt: (workflow.next_action_at as string | null) || null,
    lastActionAt: (workflow.last_action_at as string | null) || null,
  }
}

function workflowOutcomeFactors(workflowOutcomes: WorkflowOutcomes | null): ScoreFactor[] {
  if (!workflowOutcomes) return []

  const factors: ScoreFactor[] = []

  if (workflowOutcomes.failed > 0) {
    factors.push({
      factor: 'Workflow delivery reliability',
      impact: `${workflowOutcomes.failed} failed automation action(s) need recovery`,
      type: 'negative',
    })
  }

  if (workflowOutcomes.retried > 0) {
    factors.push({
      factor: 'Workflow retry pressure',
      impact: `${workflowOutcomes.retried} workflow step(s) required retries`,
      type: 'neutral',
    })
  }

  if (workflowOutcomes.sent > 0) {
    factors.push({
      factor: 'Workflow progression',
      impact: `${workflowOutcomes.sent} automation action(s) delivered successfully`,
      type: 'positive',
    })
  }

  if (workflowOutcomes.workflowStatus === 'paused') {
    factors.push({
      factor: 'Workflow paused by operator',
      impact: 'Automation is paused until resumed',
      type: 'negative',
    })
  } else if (workflowOutcomes.pending > 0) {
    factors.push({
      factor: 'Pending workflow actions',
      impact: `${workflowOutcomes.pending} scheduled action(s) still pending`,
      type: 'neutral',
    })
  }

  if (workflowOutcomes.skipped > 0) {
    factors.push({
      factor: 'Skipped workflow actions',
      impact: `${workflowOutcomes.skipped} action(s) skipped due to channel/context constraints`,
      type: 'neutral',
    })
  }

  return factors
}

async function getLeadPropertyId(
  leadId: string
): Promise<{ propertyId: string | null; exists: boolean }> {
  const serviceClient = createServiceClient()
  const { data: lead, error } = await serviceClient
    .from('leads')
    .select('property_id')
    .eq('id', leadId)
    .single()

  if (error || !lead) {
    return { propertyId: null, exists: false }
  }

  return { propertyId: lead.property_id, exists: true }
}

// GET: Retrieve score for a lead
export async function GET(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/leadpulse/score')
  ctx.logStart()

  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const searchParams = req.nextUrl.searchParams
    const leadId = searchParams.get('leadId')

    if (!leadId) {
      ctx.logSuccess(400, { reason: 'missing_lead_id' })
      return badRequest('leadId required', ctx.responseHeaders)
    }

    const { propertyId, exists } = await getLeadPropertyId(leadId)
    if (!exists || !propertyId) {
      ctx.logSuccess(404, { reason: 'lead_not_found', leadId })
      return notFound('Lead', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', leadId, propertyId })
      return forbidden(ctx.responseHeaders)
    }

    // Get latest score for this lead
    const { data: score, error } = await supabase
      .from('lead_scores')
      .select('*')
      .eq('lead_id', leadId)
      .order('scored_at', { ascending: false })
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') {
      ctx.logError(500, error, { operation: 'fetch_lead_score', leadId })
      return serverError(error, ctx.responseHeaders)
    }

    if (!score) {
      // No existing score, calculate one
      const serviceClient = createServiceClient()
      
      const { data: newScoreId, error: scoreError } = await serviceClient
        .rpc('score_lead', { p_lead_id: leadId })

      if (scoreError) {
        ctx.logError(500, scoreError, { operation: 'calculate_lead_score', leadId })
        return serverError(scoreError, ctx.responseHeaders)
      }

      // Fetch the newly created score
      const { data: newScore, error: fetchError } = await serviceClient
        .from('lead_scores')
        .select('*')
        .eq('id', newScoreId)
        .single()

      if (fetchError || !newScore) {
        ctx.logError(500, fetchError || 'Missing calculated score', {
          operation: 'fetch_calculated_lead_score',
          leadId,
        })
        return serverError(fetchError || 'Missing calculated score', ctx.responseHeaders)
      }

      const workflowOutcomes = await getWorkflowOutcomesForLead(leadId)

      ctx.logSuccess(200, { leadId, isNew: true, hasWorkflowOutcomes: Boolean(workflowOutcomes) })

      return NextResponse.json(
        {
          score: formatScore(newScore, workflowOutcomes),
          isNew: true,
        },
        { headers: ctx.responseHeaders }
      )
    }

    const workflowOutcomes = await getWorkflowOutcomesForLead(leadId)

    ctx.logSuccess(200, { leadId, isNew: false, hasWorkflowOutcomes: Boolean(workflowOutcomes) })

    return NextResponse.json(
      {
        score: formatScore(score, workflowOutcomes),
        isNew: false,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_lead_score' })
    return serverError(error, ctx.responseHeaders)
  }
}

// POST: Recalculate score for a lead (or batch)
export async function POST(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/leadpulse/score')
  ctx.logStart()

  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const body = await req.json()
    const { leadId, leadIds, propertyId } = body

    const serviceClient = createServiceClient()

    // Single lead scoring
    if (leadId) {
      const { propertyId, exists } = await getLeadPropertyId(leadId)
      if (!exists || !propertyId) {
        ctx.logSuccess(404, { reason: 'lead_not_found', leadId })
        return notFound('Lead', ctx.responseHeaders)
      }

      const access = await validatePropertyAccess(user.id, propertyId)
      if (!access.authorized) {
        ctx.logSuccess(403, { reason: 'forbidden', leadId, propertyId })
        return forbidden(ctx.responseHeaders)
      }

      const { data: scoreId, error } = await serviceClient
        .rpc('score_lead', { p_lead_id: leadId })

      if (error) {
        ctx.logError(500, error, { operation: 'score_single_lead', leadId })
        return serverError(error, ctx.responseHeaders)
      }

      // Fetch the score
      const { data: score } = await serviceClient
        .from('lead_scores')
        .select('*')
        .eq('id', scoreId)
        .single()

      const workflowOutcomes = await getWorkflowOutcomesForLead(leadId)

      ctx.logSuccess(200, { leadId, scoreId: scoreId || null, hasWorkflowOutcomes: Boolean(workflowOutcomes) })

      return NextResponse.json(
        {
          success: true,
          score: score ? formatScore(score, workflowOutcomes) : null,
        },
        { headers: ctx.responseHeaders }
      )
    }

    // Batch scoring
    if (leadIds && Array.isArray(leadIds)) {
      const { data: leadsForBatch, error: batchLeadError } = await serviceClient
        .from('leads')
        .select('id, property_id')
        .in('id', leadIds)

      if (batchLeadError) {
        ctx.logError(500, batchLeadError, { operation: 'resolve_batch_leads' })
        return serverError(batchLeadError, ctx.responseHeaders)
      }

      const uniquePropertyIds = [
        ...new Set(
          (leadsForBatch || [])
            .map(lead => lead.property_id)
            .filter((id): id is string => Boolean(id))
        ),
      ]
      for (const propertyId of uniquePropertyIds) {
        const access = await validatePropertyAccess(user.id, propertyId)
        if (!access.authorized) {
          ctx.logSuccess(403, { reason: 'forbidden', propertyId, batch: true })
          return forbidden(ctx.responseHeaders)
        }
      }

      const results: PromiseSettledResult<{ leadId: string; scoreId: unknown; error: unknown }>[] = []
      for (const chunk of chunkArray(leadIds, 50)) {
        const chunkResults = await Promise.allSettled(
          chunk.map(async (id: string) => {
            const { data: scoreId, error } = await serviceClient
              .rpc('score_lead', { p_lead_id: id })
            return { leadId: id, scoreId, error }
          })
        )
        results.push(...chunkResults)
      }

      const { successful, failed } = summarizeScoreResults(results)

      ctx.logSuccess(200, {
        batch: true,
        processed: leadIds.length,
        successful,
        failed,
      })

      return NextResponse.json(
        {
          success: true,
          processed: leadIds.length,
          successful,
          failed,
        },
        { headers: ctx.responseHeaders }
      )
    }

    // Score all leads for a property
    if (propertyId) {
      const access = await validatePropertyAccess(user.id, propertyId)
      if (!access.authorized) {
        ctx.logSuccess(403, { reason: 'forbidden', propertyId, propertyBatch: true })
        return forbidden(ctx.responseHeaders)
      }

      // Get all leads for property
      const { data: leads, error: leadsError } = await serviceClient
        .from('leads')
        .select('id')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false })
        .limit(500) // Safety limit

      if (leadsError) {
        ctx.logError(500, leadsError, { operation: 'fetch_property_leads', propertyId })
        return serverError(leadsError, ctx.responseHeaders)
      }

      const results: PromiseSettledResult<{ leadId: string; scoreId: unknown; error: unknown }>[] = []
      for (const chunk of chunkArray(leads, 50)) {
        const chunkResults = await Promise.allSettled(
          chunk.map(async (lead) => {
            const { data: scoreId, error } = await serviceClient
              .rpc('score_lead', { p_lead_id: lead.id })
            return { leadId: lead.id, scoreId, error }
          })
        )
        results.push(...chunkResults)
      }

      const { successful, failed } = summarizeScoreResults(results)

      ctx.logSuccess(200, {
        propertyId,
        processed: leads.length,
        successful,
        failed,
      })

      return NextResponse.json(
        {
          success: true,
          processed: leads.length,
          successful,
          failed,
        },
        { headers: ctx.responseHeaders }
      )
    }

    ctx.logSuccess(400, { reason: 'missing_scoring_target' })
    return badRequest('leadId, leadIds, or propertyId required', ctx.responseHeaders)
  } catch (error) {
    ctx.logError(500, error, { operation: 'score_leads' })
    return serverError(error, ctx.responseHeaders)
  }
}

// Format score for API response
function formatScore(score: Record<string, unknown>, workflowOutcomes: WorkflowOutcomes | null): LeadScore {
  const baseFactors = (score.factors as ScoreFactor[]) || []
  const explanationFactors = workflowOutcomeFactors(workflowOutcomes)
  return {
    id: score.id as string,
    leadId: score.lead_id as string,
    totalScore: score.total_score as number,
    engagementScore: score.engagement_score as number,
    timingScore: score.timing_score as number,
    sourceScore: score.source_score as number,
    completenessScore: score.completeness_score as number,
    behaviorScore: score.behavior_score as number,
    scoreBucket: score.score_bucket as 'hot' | 'warm' | 'cold' | 'unqualified',
    factors: [...baseFactors, ...explanationFactors],
    workflowOutcomes: workflowOutcomes || undefined,
    scoredAt: score.scored_at as string,
    modelVersion: score.model_version as string,
  }
}



























