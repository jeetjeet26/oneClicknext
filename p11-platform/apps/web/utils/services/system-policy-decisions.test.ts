import { beforeEach, describe, expect, it, vi } from 'vitest'

const fromMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: fromMock }),
}))

describe('recordSystemPolicyDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records a machine verdict without a reviewer identity', async () => {
    const created = {
      id: 'decision-1',
      actor_type: 'system_policy',
      decision_status: 'approved',
      decision_reason: 'all_checks_passed',
    }
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const lookup = {
      select: vi.fn(() => lookup),
      eq: vi.fn(() => lookup),
      is: vi.fn(() => lookup),
      order: vi.fn(() => lookup),
      limit: vi.fn(() => lookup),
      maybeSingle,
    }
    const single = vi.fn().mockResolvedValue({ data: created, error: null })
    const selectInsert = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select: selectInsert }))
    fromMock.mockReturnValue({ ...lookup, insert })
    const { recordSystemPolicyDecision } = await import(
      './system-policy-decisions'
    )

    const result = await recordSystemPolicyDecision({
      orgId: 'org-1',
      propertyId: 'property-1',
      policyName: 'siteforge.preview.certification',
      policyVersion: '1',
      verdict: 'approved',
      reasonCode: 'all_checks_passed',
      source: { artifactHash: 'abc' },
    })

    expect(result).toEqual(created)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_type: 'system_policy',
        decision_reason: 'all_checks_passed',
        source_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    )
  })
})
