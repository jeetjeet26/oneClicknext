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

    const claimMaybeSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'action-1' },
      error: null,
    })
    const decisionEqMock = vi.fn(() => ({
      select: vi.fn(() => ({ maybeSingle: claimMaybeSingleMock })),
    }))
    const updateEqMock = vi.fn(() => ({ eq: decisionEqMock }))
    const updateMock = vi.fn(() => ({ eq: updateEqMock }))

    const approvalSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'approval-1', decision_status: 'modified' },
      error: null,
    })
    const approvalInsertMock = vi.fn(() => ({
      select: vi.fn(() => ({ single: approvalSingleMock })),
    }))
    const approvalLookup = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            })),
          })),
        })),
      })),
    }

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
    const policyLookup = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              })),
            })),
          })),
        })),
      })),
    }

    fromMock.mockImplementation((table: string) => {
      if (table === 'shared_action_attempts') {
        return { select: selectMock, update: updateMock }
      }
      if (table === 'shared_approvals') {
        return { ...approvalLookup, insert: approvalInsertMock }
      }
      if (table === 'shared_policy_decisions') {
        return { ...policyLookup, insert: policyInsertMock }
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

  it('resumes an exact approved decision after its domain projection failed', async () => {
    const action = {
      id: 'action-1',
      job_id: 'job-1',
      org_id: 'org-1',
      property_id: 'property-1',
      action_type: 'siteforge.artifact:deploy_staging',
      proposal_decision_status: 'approved',
      request_payload: {},
      execution_payload: {},
      reviewed_by: 'reviewer-1',
      updated_at: '2026-08-10T20:00:00.000Z',
    }
    const actionSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: action, error: null }),
        })),
      })),
    }))
    const approval = {
      id: 'approval-1',
      action_attempt_id: action.id,
      decision_status: 'approved',
      decision_reason: 'looks good',
      reviewer_profile_id: 'reviewer-1',
      decision_payload: { artifactId: 'artifact-1' },
    }
    const approvalSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: approval,
              error: null,
            }),
          })),
        })),
      })),
    }))
    const approvalInsert = vi.fn()
    fromMock.mockImplementation((table: string) => {
      if (table === 'shared_action_attempts') return { select: actionSelect }
      if (table === 'shared_approvals') {
        return { select: approvalSelect, insert: approvalInsert }
      }
      return {}
    })

    await expect(
      recordSharedApprovalDecision(
        {
          propertyId: 'property-1',
          actionAttemptId: action.id,
          reviewerProfileId: 'reviewer-1',
          decisionStatus: 'approved',
          decisionReason: 'looks good',
          decisionPayload: { artifactId: 'artifact-1' },
        },
        buildMockSupabase()
      )
    ).resolves.toMatchObject({
      approval: { id: 'approval-1' },
      actionAttempt: { proposalDecisionStatus: 'approved' },
    })
    expect(approvalInsert).not.toHaveBeenCalled()
  })

  it('rejects a retry from a different reviewer', async () => {
    const actionSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'action-1',
              job_id: 'job-1',
              org_id: 'org-1',
              property_id: 'property-1',
              action_type: 'siteforge.artifact:deploy_staging',
              proposal_decision_status: 'approved',
              request_payload: {},
              execution_payload: {},
              reviewed_by: 'reviewer-1',
              updated_at: '2026-08-10T20:00:00.000Z',
            },
            error: null,
          }),
        })),
      })),
    }))
    const approvalSelect = vi.fn()
    fromMock.mockImplementation((table: string) => {
      if (table === 'shared_action_attempts') return { select: actionSelect }
      if (table === 'shared_approvals') return { select: approvalSelect }
      return {}
    })

    await expect(
      recordSharedApprovalDecision(
        {
          propertyId: 'property-1',
          actionAttemptId: 'action-1',
          reviewerProfileId: 'reviewer-2',
          decisionStatus: 'approved',
          decisionReason: 'looks good',
          decisionPayload: {
            artifactId: 'artifact-1',
            contentHash: 'a'.repeat(64),
          },
        },
        buildMockSupabase()
      )
    ).rejects.toMatchObject({
      message: 'Approval candidate has already been decided',
      statusCode: 409,
    } satisfies Partial<SharedApprovalError>)
    expect(approvalSelect).not.toHaveBeenCalled()
  })

  it('rejects a retry whose approval payload has a different artifact hash', async () => {
    const action = {
      id: 'action-1',
      job_id: 'job-1',
      org_id: 'org-1',
      property_id: 'property-1',
      action_type: 'siteforge.artifact:deploy_staging',
      proposal_decision_status: 'approved',
      request_payload: {},
      execution_payload: {},
      reviewed_by: 'reviewer-1',
      updated_at: '2026-08-10T20:00:00.000Z',
    }
    const actionSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: action, error: null }),
        })),
      })),
    }))
    const approvalInsert = vi.fn()
    const approvalSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'approval-1',
                decision_status: 'approved',
                decision_reason: 'looks good',
                reviewer_profile_id: 'reviewer-1',
                decision_payload: {
                  artifactId: 'artifact-1',
                  contentHash: 'a'.repeat(64),
                },
              },
              error: null,
            }),
          })),
        })),
      })),
    }))
    fromMock.mockImplementation((table: string) => {
      if (table === 'shared_action_attempts') return { select: actionSelect }
      if (table === 'shared_approvals') {
        return { select: approvalSelect, insert: approvalInsert }
      }
      return {}
    })

    await expect(
      recordSharedApprovalDecision(
        {
          propertyId: 'property-1',
          actionAttemptId: action.id,
          reviewerProfileId: 'reviewer-1',
          decisionStatus: 'approved',
          decisionReason: 'looks good',
          decisionPayload: {
            artifactId: 'artifact-1',
            contentHash: 'b'.repeat(64),
          },
        },
        buildMockSupabase()
      )
    ).rejects.toMatchObject({
      message:
        'Approval candidate was already decided with different decision details',
      statusCode: 409,
    } satisfies Partial<SharedApprovalError>)
    expect(approvalInsert).not.toHaveBeenCalled()
  })

  it('resumes after the policy write persisted but its response failed', async () => {
    const action = {
      id: 'action-1',
      job_id: 'job-1',
      org_id: 'org-1',
      property_id: 'property-1',
      action_type: 'siteforge.artifact:deploy_staging',
      proposal_decision_status: 'approved',
      request_payload: {},
      execution_payload: {},
      reviewed_by: 'reviewer-1',
      updated_at: '2026-08-10T20:00:00.000Z',
    }
    const actionSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: action, error: null }),
        })),
      })),
    }))
    const approval = {
      id: 'approval-1',
      decision_status: 'approved',
      decision_reason: 'looks good',
      reviewer_profile_id: 'reviewer-1',
      decision_payload: {
        artifactId: 'artifact-1',
        contentHash: 'a'.repeat(64),
      },
    }
    const approvalSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: approval,
              error: null,
            }),
          })),
        })),
      })),
    }))
    const policy = {
      id: 'policy-1',
      policy_name: 'siteforge-artifact-deployment',
      policy_version: 'v1',
      decision_status: 'approved',
      decision_reason: 'looks good',
      confidence_score: 1,
      decision_payload: { canonicalPreviewArtifactId: 'artifact-1' },
    }
    let policyPersisted = false
    const policySelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: policyPersisted ? policy : null,
                error: null,
              })),
            })),
          })),
        })),
      })),
    }))
    const policyInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => {
          policyPersisted = true
          return {
            data: null,
            error: { message: 'response lost after insert' },
          }
        }),
      })),
    }))
    const approvalInsert = vi.fn()
    fromMock.mockImplementation((table: string) => {
      if (table === 'shared_action_attempts') return { select: actionSelect }
      if (table === 'shared_approvals') {
        return { select: approvalSelect, insert: approvalInsert }
      }
      if (table === 'shared_policy_decisions') {
        return { select: policySelect, insert: policyInsert }
      }
      return {}
    })
    const input = {
      propertyId: 'property-1',
      actionAttemptId: action.id,
      reviewerProfileId: 'reviewer-1',
      decisionStatus: 'approved' as const,
      decisionReason: 'looks good',
      decisionPayload: {
        artifactId: 'artifact-1',
        contentHash: 'a'.repeat(64),
      },
      policyDecision: {
        policyName: 'siteforge-artifact-deployment',
        policyVersion: 'v1',
        confidenceScore: 1,
        decisionPayload: { canonicalPreviewArtifactId: 'artifact-1' },
      },
    }

    await expect(
      recordSharedApprovalDecision(input, buildMockSupabase())
    ).rejects.toMatchObject({
      message: 'Failed to record policy decision',
      statusCode: 500,
    } satisfies Partial<SharedApprovalError>)
    await expect(
      recordSharedApprovalDecision(input, buildMockSupabase())
    ).resolves.toMatchObject({
      approval: { id: 'approval-1' },
      policyDecision: { id: 'policy-1' },
    })
    expect(approvalInsert).not.toHaveBeenCalled()
    expect(policyInsert).toHaveBeenCalledOnce()
  })

  it('repairs a claimed decision whose approval row was not persisted', async () => {
    const action = {
      id: 'action-1',
      job_id: 'job-1',
      org_id: 'org-1',
      property_id: 'property-1',
      action_type: 'siteforge.launch:promote_production',
      proposal_decision_status: 'approved',
      request_payload: {},
      execution_payload: {},
      reviewed_by: 'reviewer-1',
      updated_at: '2026-08-10T20:00:00.000Z',
    }
    const actionSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: action, error: null }),
        })),
      })),
    }))
    const approvalSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          })),
        })),
      })),
    }))
    const approvalInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'approval-repaired',
            decision_status: 'approved',
          },
          error: null,
        }),
      })),
    }))
    const repairClaim = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: action.id },
                  error: null,
                }),
              })),
            })),
          })),
        })),
      })),
    }))
    fromMock.mockImplementation((table: string) => {
      if (table === 'shared_action_attempts') {
        return { select: actionSelect, update: repairClaim }
      }
      if (table === 'shared_approvals') {
        return { select: approvalSelect, insert: approvalInsert }
      }
      return {}
    })

    await expect(
      recordSharedApprovalDecision(
        {
          propertyId: 'property-1',
          actionAttemptId: action.id,
          reviewerProfileId: 'reviewer-1',
          decisionStatus: 'approved',
          decisionReason: 'approved',
        },
        buildMockSupabase()
      )
    ).resolves.toMatchObject({
      approval: { id: 'approval-repaired' },
    })
    expect(approvalInsert).toHaveBeenCalledOnce()
    expect(repairClaim).toHaveBeenCalledOnce()
  })

  it('loses a concurrent approval claim before writing decision records', async () => {
    const action = {
      id: 'action-1',
      job_id: 'job-1',
      org_id: 'org-1',
      property_id: 'property-1',
      action_type: 'publish_post',
      proposal_decision_status: 'proposed',
      request_payload: {},
      execution_payload: {},
    }
    const selectSingle = vi.fn().mockResolvedValue({ data: action, error: null })
    const select = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({ single: selectSingle })),
      })),
    }))
    const claimMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({ maybeSingle: claimMaybeSingle })),
        })),
      })),
    }))
    const approvalInsert = vi.fn()
    fromMock.mockImplementation((table: string) => {
      if (table === 'shared_action_attempts') return { select, update }
      if (table === 'shared_approvals') return { insert: approvalInsert }
      return {}
    })

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
      message: 'Approval candidate was decided concurrently',
      statusCode: 409,
    })
    expect(approvalInsert).not.toHaveBeenCalled()
  })
})

