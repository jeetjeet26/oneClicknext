import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listPendingSharedApprovalCandidates,
  recordSharedApprovalDecision,
  SharedApprovalError,
} from './shared-approvals'

const fromMock = vi.fn()

function buildMockSupabase() {
  return { from: fromMock } as unknown as ReturnType<
    typeof import('@/utils/supabase/admin').createServiceClient
  >
}

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(),
}))

describe('shared approvals service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists pending approval candidates for a property', async () => {
    const limitMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'action-1',
          job_id: 'job-1',
          org_id: 'org-1',
          property_id: 'property-1',
          action_type: 'publish_post',
          lifecycle_status: 'queued',
          proposal_decision_status: 'proposed',
          execution_status: 'queued',
          request_payload: {},
          execution_payload: {},
          proposed_at: '2026-03-17T00:00:00.000Z',
          decided_at: null,
          reviewed_by: null,
          policy_reason: null,
          confidence_score: null,
        },
      ],
      error: null,
    })
    const orderMock = vi.fn(() => ({ limit: limitMock }))
    const proposedEqMock = vi.fn(() => ({ order: orderMock }))
    const propertyEqMock = vi.fn(() => ({ eq: proposedEqMock }))
    const selectMock = vi.fn(() => ({ eq: propertyEqMock }))
    fromMock.mockReturnValue({ select: selectMock })

    const approvals = await listPendingSharedApprovalCandidates('property-1', 20, buildMockSupabase())

    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({
      id: 'action-1',
      actionType: 'publish_post',
    })
  })

  it('records modified decisions and optional policy decisions', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'action-1',
        job_id: 'job-1',
        org_id: 'org-1',
        property_id: 'property-1',
        action_type: 'publish_post',
        proposal_decision_status: 'proposed',
        request_payload: {},
        execution_payload: {},
      },
      error: null,
    })
    const propertyEqMock = vi.fn(() => ({ single: singleMock }))
    const idEqMock = vi.fn(() => ({ eq: propertyEqMock }))
    const selectMock = vi.fn(() => ({ eq: idEqMock }))

    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn(() => ({ eq: updateEqMock }))

    const approvalSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'approval-1', decision_status: 'modified' },
      error: null,
    })
    const approvalInsertMock = vi.fn(() => ({
      select: vi.fn(() => ({ single: approvalSingleMock })),
    }))

    const policySingleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'policy-1',
        policy_name: 'content_safety',
        decision_status: 'modified',
        decision_reason: 'adjust copy',
      },
      error: null,
    })
    const policyInsertMock = vi.fn(() => ({
      select: vi.fn(() => ({ single: policySingleMock })),
    }))

    fromMock.mockImplementation((table: string) => {
      if (table === 'shared_action_attempts') {
        return { select: selectMock, update: updateMock }
      }
      if (table === 'shared_approvals') {
        return { insert: approvalInsertMock }
      }
      if (table === 'shared_policy_decisions') {
        return { insert: policyInsertMock }
      }
      return {}
    })

    const result = await recordSharedApprovalDecision(
      {
        propertyId: 'property-1',
        actionAttemptId: 'action-1',
        reviewerProfileId: 'reviewer-1',
        decisionStatus: 'modified',
        decisionReason: 'adjust copy',
        modifiedPayload: { title: 'Updated' },
        policyDecision: {
          policyName: 'content_safety',
          confidenceScore: 0.92,
        },
      },
      buildMockSupabase()
    )

    expect(result.approval).toMatchObject({ id: 'approval-1' })
    expect(result.policyDecision).toMatchObject({ id: 'policy-1' })
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal_decision_status: 'modified',
        execution_status: 'approved_pending_execution',
        execution_payload: { title: 'Updated' },
      })
    )
  })

  it('requires modified payload when decision is modified', async () => {
    await expect(
      recordSharedApprovalDecision(
        {
          propertyId: 'property-1',
          actionAttemptId: 'action-1',
          reviewerProfileId: 'reviewer-1',
          decisionStatus: 'modified',
          decisionReason: 'needs changes',
        },
        buildMockSupabase()
      )
    ).rejects.toMatchObject({
      message: 'modifiedPayload is required when decisionStatus is modified',
      statusCode: 400,
    } satisfies Partial<SharedApprovalError>)
  })

  it('rejects duplicate decisions when action attempt is already decided', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'action-1',
        job_id: 'job-1',
        org_id: 'org-1',
        property_id: 'property-1',
        action_type: 'publish_post',
        proposal_decision_status: 'approved',
        request_payload: {},
        execution_payload: {},
      },
      error: null,
    })
    const propertyEqMock = vi.fn(() => ({ single: singleMock }))
    const idEqMock = vi.fn(() => ({ eq: propertyEqMock }))
    const selectMock = vi.fn(() => ({ eq: idEqMock }))
    fromMock.mockReturnValue({ select: selectMock })

    await expect(
      recordSharedApprovalDecision(
        {
          propertyId: 'property-1',
          actionAttemptId: 'action-1',
          reviewerProfileId: 'reviewer-1',
          decisionStatus: 'approved',
          decisionReason: 'looks good',
        },
        buildMockSupabase()
      )
    ).rejects.toMatchObject({
      message: 'Approval candidate has already been decided',
      statusCode: 409,
    } satisfies Partial<SharedApprovalError>)
  })
})

