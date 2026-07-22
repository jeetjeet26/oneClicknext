import { beforeEach, describe, expect, it, vi } from 'vitest'

const runSharedExecutorJobMock = vi.hoisted(() => vi.fn())

vi.mock('@/utils/services/shared-executor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/services/shared-executor')>()
  return {
    ...actual,
    runSharedExecutorJob: runSharedExecutorJobMock,
  }
})

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({})),
}))

import {
  SharedExecutorApprovalRequiredError,
  SharedExecutorDuplicateJobError,
} from '@/utils/services/shared-executor'

const baseRecommendation = {
  id: 'rec-1',
  recommendationType: 'forgestudio_messaging_brief',
  title: 'Respond to competitor concession push',
  rationale: 'Two competitors added one month free.',
  impact: 0.7,
  confidence: 0.8,
  freshness: 0.9,
  reversibility: 1,
  citations: [],
}

describe('createMarketVisionProposal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns ledger ids when the executor requires approval', async () => {
    runSharedExecutorJobMock.mockRejectedValue(
      new SharedExecutorApprovalRequiredError('approval required', 'job-1', 'attempt-1'),
    )

    const { createMarketVisionProposal } = await import('./marketvision-proposals')
    const result = await createMarketVisionProposal({
      orgId: 'org-1',
      propertyId: 'property-1',
      requestedBy: 'user-1',
      proposalType: 'forgestudio_messaging_brief',
      recommendation: baseRecommendation,
    })

    expect(result).toEqual({
      sharedJobId: 'job-1',
      actionAttemptId: 'attempt-1',
      proposalType: 'forgestudio_messaging_brief',
    })

    // The executor was called with a proposed (approval-gated) action.
    const call = runSharedExecutorJobMock.mock.calls[0][0]
    expect(call.domain).toBe('marketvision.proposal')
    expect(call.action.proposalDecisionStatus).toBe('proposed')
    expect(call.action.actionType).toBe('forgestudio_messaging_brief')
    expect(call.action.confidenceScore).toBe(0.8)
    expect(call.dedupeKey).toBe('proposal:property-1:rec-1:forgestudio_messaging_brief')
  })

  it('marks pricing proposals with the pricing-sensitive policy reason', async () => {
    runSharedExecutorJobMock.mockRejectedValue(
      new SharedExecutorApprovalRequiredError('approval required', 'job-2', 'attempt-2'),
    )

    const { createMarketVisionProposal } = await import('./marketvision-proposals')
    await createMarketVisionProposal({
      orgId: 'org-1',
      propertyId: 'property-1',
      requestedBy: 'user-1',
      proposalType: 'operator_pricing_review',
      recommendation: { ...baseRecommendation, id: 'rec-2' },
    })

    const call = runSharedExecutorJobMock.mock.calls[0][0]
    expect(call.action.policyReason).toBe('pricing_sensitive_actions_require_human_review')
  })

  it('translates duplicate jobs into a 409 proposal error', async () => {
    runSharedExecutorJobMock.mockRejectedValue(
      new SharedExecutorDuplicateJobError('duplicate', 'job-1', 'queued'),
    )

    const { createMarketVisionProposal, MarketVisionProposalError } = await import(
      './marketvision-proposals'
    )

    await expect(
      createMarketVisionProposal({
        orgId: 'org-1',
        propertyId: 'property-1',
        requestedBy: 'user-1',
        proposalType: 'forgestudio_messaging_brief',
        recommendation: baseRecommendation,
      }),
    ).rejects.toThrowError(MarketVisionProposalError)
  })

  it('rejects unknown proposal types', async () => {
    const { createMarketVisionProposal, MarketVisionProposalError } = await import(
      './marketvision-proposals'
    )

    await expect(
      createMarketVisionProposal({
        orgId: 'org-1',
        propertyId: 'property-1',
        requestedBy: 'user-1',
        // @ts-expect-error - intentionally invalid
        proposalType: 'auto_publish_everything',
        recommendation: baseRecommendation,
      }),
    ).rejects.toThrowError(MarketVisionProposalError)
    expect(runSharedExecutorJobMock).not.toHaveBeenCalled()
  })
})

describe('listMarketVisionProposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('joins proposals with recorded outcomes', async () => {
    const attemptsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'attempt-1',
            job_id: 'job-1',
            action_type: 'forgestudio_messaging_brief',
            proposal_decision_status: 'approved',
            execution_status: 'executed',
            lifecycle_status: 'succeeded',
            request_payload: {},
            execution_payload: {},
            policy_reason: null,
            confidence_score: 0.8,
            proposed_at: '2026-07-20T00:00:00Z',
            decided_at: '2026-07-21T00:00:00Z',
            reviewed_by: 'user-2',
            error_message: null,
          },
        ],
        error: null,
      }),
    }
    const outcomesQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [
          {
            action_attempt_id: 'attempt-1',
            kpi_name: 'qualified_leads',
            outcome_status: 'positive',
            baseline_value: 10,
            observed_value: 14,
            delta_value: 4,
          },
        ],
        error: null,
      }),
    }
    const supabase = {
      from: vi.fn((table: string) =>
        table === 'shared_action_attempts' ? attemptsQuery : outcomesQuery,
      ),
    }

    const { listMarketVisionProposals } = await import('./marketvision-proposals')
    const proposals = await listMarketVisionProposals(
      'property-1',
      20,
      supabase as never,
    )

    expect(proposals).toHaveLength(1)
    expect(proposals[0].proposalDecisionStatus).toBe('approved')
    expect(proposals[0].outcomes).toEqual([
      {
        kpiName: 'qualified_leads',
        outcomeStatus: 'positive',
        baselineValue: 10,
        observedValue: 14,
        deltaValue: 4,
      },
    ])
  })
})
