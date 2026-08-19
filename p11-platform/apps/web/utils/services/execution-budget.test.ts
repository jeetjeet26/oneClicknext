import { beforeEach, describe, expect, it, vi } from 'vitest'

const fromMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: fromMock, rpc: rpcMock }),
}))

describe('execution budgets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a bounded website budget with a deterministic deadline', async () => {
    const row = { id: 'budget-1' }
    const single = vi.fn().mockResolvedValue({ data: row, error: null })
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    fromMock.mockReturnValue({ insert })
    const { createExecutionBudget } = await import('./execution-budget')

    const result = await createExecutionBudget({
      orgId: 'org-1',
      propertyId: 'property-1',
      websiteId: 'website-1',
      policyVersion: 'siteforge.autonomy.v1',
      startedAt: '2026-08-18T00:00:00.000Z',
      limits: { maxWallSeconds: 3_600, maxCostCents: 25_000 },
    })

    expect(result).toEqual(row)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        max_cost_cents: 25_000,
        max_wall_seconds: 3_600,
        deadline_at: '2026-08-18T01:00:00.000Z',
      })
    )
  })

  it('reserves budget atomically through the database function', async () => {
    rpcMock.mockResolvedValue({ data: { id: 'budget-1' }, error: null })
    const { reserveExecutionBudget } = await import('./execution-budget')

    await reserveExecutionBudget('budget-1', {
      idempotencyKey: 'generation:attempt-1',
      costCents: 100,
      inputTokens: 1_000,
      modelAttempts: 1,
    })

    expect(rpcMock).toHaveBeenCalledWith(
      'reserve_shared_execution_budget_v2',
      expect.objectContaining({
        p_budget_id: 'budget-1',
        p_idempotency_key: 'generation:attempt-1',
        p_cost_cents: 100,
        p_input_tokens: 1_000,
        p_model_attempts: 1,
      })
    )
  })

  it('rejects invalid negative reservations before any database call', async () => {
    const { reserveExecutionBudget } = await import('./execution-budget')
    await expect(
      reserveExecutionBudget('budget-1', {
        idempotencyKey: 'repair:negative',
        repairOperations: -1,
      })
    ).rejects.toThrow('repairOperations must be a non-negative number')
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
