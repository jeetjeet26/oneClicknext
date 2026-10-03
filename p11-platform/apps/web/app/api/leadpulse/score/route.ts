import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'
import { leadPulseScoreRequestSchema } from '@/utils/services/validation'
import { leadpulseRpc, leadpulseScope, leadpulseUser, reply, resultReply, unconfirmed } from '@/utils/leadpulse/server'

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
  provenance?: Record<string, unknown>
  workflowFactors?: ScoreFactor[]
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


async function scoreResponse(propertyId: string, userId: string, leadId: string, scoreId?: string) {
  const saved = await leadpulseRpc('read_leadpulse_score', { p_property_id: propertyId, p_actor_id: userId, p_lead_id: leadId, p_score_id: scoreId || null })
  if (saved.state !== 'saved') return saved
  const workflow = await getWorkflowOutcomesForLead(leadId)
  return { ...saved, score: { ...formatScore(saved.score as Record<string, unknown>, workflow), provenance: saved.provenance } }
}
export async function GET(req: NextRequest) {
  try {
    const user = await leadpulseUser(); if (!user) return reply({ error: 'Unauthorized' }, 401)
    const leadId = req.nextUrl.searchParams.get('leadId')
    if (!leadId) return reply({ error: 'leadId required' }, 400)
    const scope = await leadpulseScope(user.id, { leadId }); if (scope.response) return scope.response
    return resultReply(await scoreResponse(scope.propertyId!, user.id, leadId))
  } catch { return unconfirmed() }
}
export async function POST(req: NextRequest) {
  try {
    const user = await leadpulseUser(); if (!user) return reply({ error: 'Unauthorized' }, 401)
    const parsed = leadPulseScoreRequestSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return reply({ error: 'A stable request identity and one scoring target are required.' }, 400)
    const input = parsed.data
    const scope = await leadpulseScope(user.id, input); if (scope.response) return scope.response
    const batch = await leadpulseRpc('run_lead_score_batch', { p_property_id: scope.propertyId, p_actor_id: user.id, p_request_id: input.requestId, p_lead_ids: input.leadId ? [input.leadId] : input.leadIds || null, p_retry_batch_id: input.retryBatchId || null })
    if (!['running', 'completed', 'cancelled'].includes(String(batch.state))) return resultReply(batch)
    let score: unknown = null
    if (input.leadId && typeof batch.scoreId === 'string') {
      const saved = await scoreResponse(scope.propertyId!, user.id, input.leadId, batch.scoreId)
      if (saved.state !== 'saved' || !saved.score) return unconfirmed()
      score = saved.score
    }
    return reply({ ...batch, score, success: batch.state === 'completed' && batch.failed === 0 })
  } catch { return unconfirmed() }
}
const controlSchema = z.object({ propertyId: z.string().min(1).max(100), batchId: z.string().uuid(), requestId: z.string().uuid(), action: z.enum(['continue', 'cancel']) }).strict()
export async function PATCH(req: NextRequest) {
  try {
    const user = await leadpulseUser(); if (!user) return reply({ error: 'Unauthorized' }, 401)
    const parsed = controlSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return reply({ error: 'A saved scoring run and decision identity are required.' }, 400)
    const { propertyId, batchId, requestId, action } = parsed.data
    const scope = await leadpulseScope(user.id, { propertyId }); if (scope.response) return scope.response
    return resultReply(await leadpulseRpc(action === 'continue' ? 'continue_lead_score_batch' : 'cancel_lead_score_batch', {
      p_property_id: propertyId, p_actor_id: user.id, p_batch_id: batchId, ...(action === 'cancel' ? { p_request_id: requestId } : {}),
    }))
  } catch { return unconfirmed() }
}
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
    factors: baseFactors,
    workflowFactors: explanationFactors,
    workflowOutcomes: workflowOutcomes || undefined,
    scoredAt: score.scored_at as string,
    modelVersion: score.model_version as string,
  }
}
