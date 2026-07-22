/**
 * Reputation case service.
 *
 * A reputation case is the primary product object of ReviewFlow: the lifecycle
 * wrapper connecting a review, its versioned intelligence, response artifacts,
 * decisions, provider execution, and remediation. Cases carry an immutable
 * event timeline in reputation_case_events.
 */

import { createServiceClient } from '@/utils/supabase/admin'
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/types/supabase'
import {
  derivePriority,
  slaDueAtForPriority,
  type CasePriority,
} from '@/utils/reviewflow/taxonomy'
import type { ReviewAnalysisResult } from '@/utils/reviewflow/ai'

type ServiceClient = ReturnType<typeof createServiceClient>

export type ReputationCaseRow = Tables<'reputation_cases'>

export type CaseStatus =
  | 'open'
  | 'triaged'
  | 'awaiting_approval'
  | 'ready_to_post'
  | 'remediation'
  | 'resolved'
  | 'dismissed'

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['resolved', 'dismissed'])

export async function recordCaseEvent(
  supabase: ServiceClient,
  input: {
    caseId: string
    propertyId: string | null
    eventType: string
    actorProfileId?: string | null
    actorLabel?: string | null
    payload?: Record<string, unknown>
  }
): Promise<void> {
  const insert: TablesInsert<'reputation_case_events'> = {
    case_id: input.caseId,
    property_id: input.propertyId,
    event_type: input.eventType,
    actor_profile_id: input.actorProfileId ?? null,
    actor_label: input.actorLabel ?? (input.actorProfileId ? null : 'system'),
    payload: (input.payload ?? {}) as Json,
  }
  const { error } = await supabase.from('reputation_case_events').insert(insert)
  if (error) {
    console.error('[reviewflow_cases] failed to record case event', {
      caseId: input.caseId,
      eventType: input.eventType,
      error,
    })
  }
}

/**
 * Ensure a case exists for a review; returns the case row. Newly synced or
 * imported reviews get an 'open' case with default priority until analyzed.
 */
export async function ensureCaseForReview(
  supabase: ServiceClient,
  review: {
    id: string
    property_id: string | null
    sentiment?: string | null
    is_urgent?: boolean | null
  }
): Promise<ReputationCaseRow | null> {
  if (!review.property_id) return null

  const { data: existing } = await supabase
    .from('reputation_cases')
    .select('*')
    .eq('review_id', review.id)
    .maybeSingle()

  if (existing) return existing

  const priority = derivePriority({
    isUrgent: Boolean(review.is_urgent),
    sentiment: review.sentiment ?? null,
  })

  const insert: TablesInsert<'reputation_cases'> = {
    property_id: review.property_id,
    review_id: review.id,
    status: 'open',
    priority,
    sla_due_at: slaDueAtForPriority(priority),
  }

  const { data, error } = await supabase
    .from('reputation_cases')
    .insert(insert)
    .select('*')
    .single()

  if (error || !data) {
    // Handle insert races: another worker may have created the case.
    const { data: raced } = await supabase
      .from('reputation_cases')
      .select('*')
      .eq('review_id', review.id)
      .maybeSingle()
    if (raced) return raced
    console.error('[reviewflow_cases] failed to create case', { reviewId: review.id, error })
    return null
  }

  await recordCaseEvent(supabase, {
    caseId: data.id,
    propertyId: data.property_id,
    eventType: 'case_opened',
    payload: { priority, source: 'review_observed' },
  })

  return data
}

/**
 * Apply a completed analysis to the review's case: classification, priority,
 * SLA, and triage status. Never regresses terminal cases; reopens them
 * explicitly instead so recurrence stays visible.
 */
export async function applyAnalysisToCase(
  supabase: ServiceClient,
  review: { id: string; property_id: string | null },
  analysis: ReviewAnalysisResult,
  analysisId: string | null
): Promise<void> {
  const existing = await ensureCaseForReview(supabase, {
    id: review.id,
    property_id: review.property_id,
    sentiment: analysis.sentiment,
    is_urgent: analysis.isUrgent,
  })
  if (!existing) return

  const priority: CasePriority = derivePriority({
    isUrgent: analysis.isUrgent,
    sentiment: analysis.sentiment,
    severity: analysis.severity,
    riskClass: analysis.riskClass,
  })

  const nowIso = new Date().toISOString()
  const update: TablesUpdate<'reputation_cases'> = {
    priority,
    risk_class: analysis.riskClass,
    policy_class: analysis.policyClass,
    journey_stage: analysis.journeyStage,
    issue_domains: analysis.issueDomains as unknown as Json,
    root_cause: analysis.summary,
    last_activity_at: nowIso,
    updated_at: nowIso,
  }

  if (TERMINAL_STATUSES.has(existing.status)) {
    // Terminal case with fresh intelligence stays terminal; recurrence is
    // handled by insights, not by silently reopening.
  } else if (existing.status === 'open') {
    update.status = 'triaged'
    update.sla_due_at = slaDueAtForPriority(priority)
  }

  const { error } = await supabase
    .from('reputation_cases')
    .update(update)
    .eq('id', existing.id)

  if (error) {
    console.error('[reviewflow_cases] failed to apply analysis to case', {
      caseId: existing.id,
      error,
    })
    return
  }

  await recordCaseEvent(supabase, {
    caseId: existing.id,
    propertyId: existing.property_id,
    eventType: 'analysis_recorded',
    payload: {
      analysisId,
      sentiment: analysis.sentiment,
      severity: analysis.severity,
      riskClass: analysis.riskClass,
      policyClass: analysis.policyClass,
      confidence: analysis.confidence,
      requiresHumanReview: analysis.policy.requiresHumanReview,
      model: analysis.provenance.model,
      taxonomyVersion: analysis.provenance.taxonomyVersion,
    },
  })
}

/**
 * Move a case along the response workflow. Valid transitions are enforced by
 * callers (the respond route validates response state first).
 */
export async function transitionCaseForReview(
  supabase: ServiceClient,
  reviewId: string,
  input: {
    status: CaseStatus
    eventType: string
    actorProfileId?: string | null
    payload?: Record<string, unknown>
    resolutionNotes?: string | null
  }
): Promise<void> {
  const { data: existing } = await supabase
    .from('reputation_cases')
    .select('id, property_id, status, reopened_count')
    .eq('review_id', reviewId)
    .maybeSingle()

  if (!existing) return

  const nowIso = new Date().toISOString()
  const update: TablesUpdate<'reputation_cases'> = {
    status: input.status,
    last_activity_at: nowIso,
    updated_at: nowIso,
  }

  if (input.status === 'resolved' || input.status === 'dismissed') {
    update.resolved_at = nowIso
    if (input.resolutionNotes) update.resolution_notes = input.resolutionNotes
  } else if (TERMINAL_STATUSES.has(existing.status)) {
    update.reopened_count = (existing.reopened_count ?? 0) + 1
    update.resolved_at = null
  }

  const { error } = await supabase
    .from('reputation_cases')
    .update(update)
    .eq('id', existing.id)

  if (error) {
    console.error('[reviewflow_cases] failed to transition case', {
      caseId: existing.id,
      status: input.status,
      error,
    })
    return
  }

  await recordCaseEvent(supabase, {
    caseId: existing.id,
    propertyId: existing.property_id,
    eventType: input.eventType,
    actorProfileId: input.actorProfileId,
    payload: { ...input.payload, fromStatus: existing.status, toStatus: input.status },
  })
}

/**
 * Persist a versioned analysis row. Version = latest + 1 per review.
 */
export async function persistReviewAnalysis(
  supabase: ServiceClient,
  review: { id: string; property_id: string | null },
  analysis: ReviewAnalysisResult
): Promise<string | null> {
  const { data: latest } = await supabase
    .from('review_analyses')
    .select('analysis_version')
    .eq('review_id', review.id)
    .order('analysis_version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const insert: TablesInsert<'review_analyses'> = {
    review_id: review.id,
    property_id: review.property_id,
    analysis_version: (latest?.analysis_version ?? 0) + 1,
    taxonomy_version: analysis.provenance.taxonomyVersion,
    model: analysis.provenance.model,
    prompt_version: analysis.provenance.promptVersion,
    status: analysis.policy.requiresHumanReview ? 'manual_review_required' : 'completed',
    sentiment: analysis.sentiment,
    sentiment_score: analysis.sentimentScore,
    topics: analysis.topics as unknown as Json,
    journey_stage: analysis.journeyStage,
    issue_domains: analysis.issueDomains as unknown as Json,
    severity: analysis.severity,
    risk_class: analysis.riskClass,
    policy_class: analysis.policyClass,
    policy_flags: analysis.policy.flags as unknown as Json,
    evidence: analysis.evidence as unknown as Json,
    confidence: analysis.confidence,
    is_urgent: analysis.isUrgent,
    summary: analysis.summary,
    recommended_action: analysis.recommendedAction,
    usage: analysis.usage as unknown as Json,
  }

  const { data, error } = await supabase
    .from('review_analyses')
    .insert(insert)
    .select('id')
    .single()

  if (error || !data) {
    console.error('[reviewflow_cases] failed to persist analysis', {
      reviewId: review.id,
      error,
    })
    return null
  }

  return data.id
}

/**
 * Persist a failed/invalid analysis attempt so manual-review state is visible
 * instead of silently disappearing.
 */
export async function persistFailedAnalysis(
  supabase: ServiceClient,
  review: { id: string; property_id: string | null },
  input: { model: string; errorMessage: string }
): Promise<void> {
  const { data: latest } = await supabase
    .from('review_analyses')
    .select('analysis_version')
    .eq('review_id', review.id)
    .order('analysis_version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const insert: TablesInsert<'review_analyses'> = {
    review_id: review.id,
    property_id: review.property_id,
    analysis_version: (latest?.analysis_version ?? 0) + 1,
    taxonomy_version: 'unversioned',
    model: input.model,
    prompt_version: 'unversioned',
    status: 'failed',
    error_message: input.errorMessage.slice(0, 1000),
  }

  const { error } = await supabase.from('review_analyses').insert(insert)
  if (error) {
    console.error('[reviewflow_cases] failed to persist failed analysis', {
      reviewId: review.id,
      error,
    })
  }
}
