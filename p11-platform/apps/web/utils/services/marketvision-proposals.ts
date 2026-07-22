/**
 * MarketVision governed proposals.
 *
 * Packages Market Brief recommendations as shared action attempts:
 * - Frozen context snapshot (created by the shared executor).
 * - Citations, confidence, risk class, and policy reason preserved.
 * - Always `proposed` — MarketVision never auto-executes downstream changes.
 *
 * Approve/deny/modify flows through the existing shared approvals service
 * (`/api/substrate/approvals`); approved handoffs dispatch through the shared
 * dispatcher only for products with a safe execution path.
 */

import { createServiceClient } from '@/utils/supabase/admin'
import {
  runSharedExecutorJob,
  SharedExecutorApprovalRequiredError,
  SharedExecutorDuplicateJobError,
} from '@/utils/services/shared-executor'
import type { MarketCitation } from '@/utils/marketvision/domain-types'

export const MARKETVISION_PROPOSAL_DOMAIN = 'marketvision.proposal'

export const MARKETVISION_PROPOSAL_TYPES = [
  'brandforge_positioning_review',
  'siteforge_content_patch',
  'forgestudio_messaging_brief',
  'operator_pricing_review',
] as const

export type MarketVisionProposalType = (typeof MARKETVISION_PROPOSAL_TYPES)[number]

/**
 * All MarketVision proposals are reversible reviews/drafts, never direct
 * mutations; pricing-sensitive ones carry a stricter risk class.
 */
const PROPOSAL_RISK_CLASS: Record<MarketVisionProposalType, 'review' | 'pricing_sensitive'> = {
  brandforge_positioning_review: 'review',
  siteforge_content_patch: 'review',
  forgestudio_messaging_brief: 'review',
  operator_pricing_review: 'pricing_sensitive',
}

export type MarketVisionProposalRecommendation = {
  id: string
  recommendationType: string
  title: string
  rationale: string
  impact: number
  confidence: number
  freshness: number
  reversibility: number
  citations: MarketCitation[]
}

export type CreateMarketVisionProposalInput = {
  orgId: string
  propertyId: string
  requestedBy: string
  proposalType: MarketVisionProposalType
  recommendation: MarketVisionProposalRecommendation
  /** Editable execution payload; reviewers may modify before approval. */
  executionPayload?: Record<string, unknown>
}

export class MarketVisionProposalError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'MarketVisionProposalError'
    this.statusCode = statusCode
  }
}

export async function createMarketVisionProposal(input: CreateMarketVisionProposalInput): Promise<{
  sharedJobId: string | null
  actionAttemptId: string | null
  proposalType: MarketVisionProposalType
}> {
  if (!MARKETVISION_PROPOSAL_TYPES.includes(input.proposalType)) {
    throw new MarketVisionProposalError(`Unknown proposal type: ${input.proposalType}`, 400)
  }

  const riskClass = PROPOSAL_RISK_CLASS[input.proposalType]

  const requestPayload = {
    recommendation: input.recommendation,
    riskClass,
    proposalType: input.proposalType,
  }

  const executionPayload = {
    proposalType: input.proposalType,
    title: input.recommendation.title,
    rationale: input.recommendation.rationale,
    citations: input.recommendation.citations,
    ...input.executionPayload,
  }

  try {
    await runSharedExecutorJob({
      orgId: input.orgId,
      propertyId: input.propertyId,
      domain: MARKETVISION_PROPOSAL_DOMAIN,
      subjectType: 'market_recommendation',
      subjectId: input.recommendation.id,
      // One open proposal per recommendation+type per property.
      dedupeKey: `proposal:${input.propertyId}:${input.recommendation.id}:${input.proposalType}`,
      payload: requestPayload,
      requestedBy: input.requestedBy,
      action: {
        actionType: input.proposalType,
        requestPayload,
        executionPayload,
        proposalDecisionStatus: 'proposed',
        policyReason:
          riskClass === 'pricing_sensitive'
            ? 'pricing_sensitive_actions_require_human_review'
            : 'marketvision_recommendations_require_human_review',
        confidenceScore: input.recommendation.confidence,
      },
      execute: async () => {
        // Proposals are always approval-gated; the executor throws
        // SharedExecutorApprovalRequiredError before this can run.
        throw new MarketVisionProposalError('Proposals cannot execute without approval', 500)
      },
    })
    // Unreachable: proposed actions always require approval.
    throw new MarketVisionProposalError('Proposal was unexpectedly executed', 500)
  } catch (error) {
    if (error instanceof SharedExecutorApprovalRequiredError) {
      return {
        sharedJobId: error.sharedJobId,
        actionAttemptId: error.sharedActionAttemptId,
        proposalType: input.proposalType,
      }
    }
    if (error instanceof SharedExecutorDuplicateJobError) {
      throw new MarketVisionProposalError(
        'A proposal for this recommendation already exists',
        409
      )
    }
    throw error
  }
}

export type MarketVisionProposalRecord = {
  id: string
  jobId: string
  actionType: string
  proposalDecisionStatus: string
  executionStatus: string
  lifecycleStatus: string
  requestPayload: unknown
  executionPayload: unknown
  policyReason: string | null
  confidenceScore: number | null
  proposedAt: string
  decidedAt: string | null
  reviewedBy: string | null
  errorMessage: string | null
  outcomes: Array<{
    kpiName: string
    outcomeStatus: string
    baselineValue: number | null
    observedValue: number | null
    deltaValue: number | null
  }>
}

export async function listMarketVisionProposals(
  propertyId: string,
  limit = 20,
  supabase = createServiceClient()
): Promise<MarketVisionProposalRecord[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100)

  const { data, error } = await supabase
    .from('shared_action_attempts')
    .select(
      `
        id, job_id, action_type, proposal_decision_status, execution_status,
        lifecycle_status, request_payload, execution_payload, policy_reason,
        confidence_score, proposed_at, decided_at, reviewed_by, error_message,
        shared_jobs!inner ( domain )
      `
    )
    .eq('property_id', propertyId)
    .eq('shared_jobs.domain', MARKETVISION_PROPOSAL_DOMAIN)
    .order('proposed_at', { ascending: false })
    .limit(safeLimit)

  if (error) {
    throw new MarketVisionProposalError('Failed to list proposals', 500)
  }

  const attempts = data || []
  const attemptIds = attempts.map((row) => row.id)

  let outcomesByAttempt = new Map<string, MarketVisionProposalRecord['outcomes']>()
  if (attemptIds.length > 0) {
    const { data: outcomes } = await supabase
      .from('shared_experiment_outcomes')
      .select('action_attempt_id, kpi_name, outcome_status, baseline_value, observed_value, delta_value')
      .in('action_attempt_id', attemptIds)

    outcomesByAttempt = (outcomes || []).reduce((map, row) => {
      if (!row.action_attempt_id) return map
      const list = map.get(row.action_attempt_id) || []
      list.push({
        kpiName: row.kpi_name,
        outcomeStatus: row.outcome_status ?? 'unknown',
        baselineValue: row.baseline_value,
        observedValue: row.observed_value,
        deltaValue: row.delta_value,
      })
      map.set(row.action_attempt_id, list)
      return map
    }, new Map<string, MarketVisionProposalRecord['outcomes']>())
  }

  return attempts.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    actionType: row.action_type,
    proposalDecisionStatus: row.proposal_decision_status,
    executionStatus: row.execution_status,
    lifecycleStatus: row.lifecycle_status,
    requestPayload: row.request_payload,
    executionPayload: row.execution_payload,
    policyReason: row.policy_reason,
    confidenceScore: row.confidence_score,
    proposedAt: row.proposed_at,
    decidedAt: row.decided_at,
    reviewedBy: row.reviewed_by,
    errorMessage: row.error_message,
    outcomes: outcomesByAttempt.get(row.id) || [],
  }))
}
