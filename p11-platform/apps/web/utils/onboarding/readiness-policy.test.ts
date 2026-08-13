import { describe, expect, it } from 'vitest'
import {
  evaluateReadinessApproval,
  readinessApprovalPolicyForDomain,
} from './readiness-policy'

describe('onboarding readiness approval policy', () => {
  it('allows a manager override when every conflict is operational', () => {
    expect(
      evaluateReadinessApproval({
        status: 'needs_review',
        unresolved_conflicts: [
          {
            domain: 'units',
            approvalPolicy: 'manager_override',
            reasons: ['No reviewed units'],
            sourceIds: [],
          },
          {
            domain: 'integrations',
            approvalPolicy: 'manager_override',
            reasons: ['CRM is unavailable'],
            sourceIds: [],
          },
        ],
      })
    ).toMatchObject({
      canApprove: true,
      requiresManagerOverride: true,
      hardBlockers: [],
    })
  })

  it('rejects an override when a required identity or legal conflict remains', () => {
    expect(
      evaluateReadinessApproval({
        status: 'needs_review',
        unresolved_conflicts: [
          {
            domain: 'legal',
            approvalPolicy: 'required',
            reasons: ['Legal review is incomplete'],
            sourceIds: [],
          },
        ],
      })
    ).toMatchObject({
      canApprove: false,
      requiresManagerOverride: false,
    })
  })

  it('fails closed for legacy unknown domains', () => {
    expect(readinessApprovalPolicyForDomain('unknown')).toBe('required')
  })
})
