import { describe, expect, it } from 'vitest'
import {
  canCreateSiteForgePlan,
  directorPlanFromResponse,
} from './SiteForgePlanJourney'

describe('SiteForge Web Director plan journey', () => {
  it('prevents plan creation until readiness is approved', () => {
    expect(canCreateSiteForgePlan(null)).toBe(false)
    expect(canCreateSiteForgePlan({ status: 'ready' })).toBe(false)
    expect(canCreateSiteForgePlan({ status: 'approved' })).toBe(true)
  })

  it('normalizes the planning route planState contract for Director', () => {
    const plan = directorPlanFromResponse({
      websiteId: '33333333-3333-4333-8333-333333333333',
      orgId: '44444444-4444-4444-8444-444444444444',
      planId: '11111111-1111-4111-8111-111111111111',
      planVersionId: '22222222-2222-4222-8222-222222222222',
      revision: 1,
      planState: 'ready_for_review',
      status: undefined as never,
      contentHash: 'a'.repeat(64),
      plan: {} as never,
      readiness: { ready: true, issues: [] } as never,
      approvalActionAttemptId: null,
    })

    expect(plan.status).toBe('ready_for_review')
  })
})
