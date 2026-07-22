import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

/**
 * Builds an awaitable supabase-js query chain that resolves to `result`
 * regardless of which filter/order methods are called on it.
 */
function chainResolving(result: unknown) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'gte', 'lte', 'lt', 'order', 'limit', 'not', 'in']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

/** Returns queued results per table in the order the route queries them. */
function mockServiceClientWithQueues(queues: Record<string, unknown[]>) {
  const remaining: Record<string, unknown[]> = Object.fromEntries(
    Object.entries(queues).map(([table, results]) => [table, [...results]])
  )
  createServiceClientMock.mockReturnValue({
    from: vi.fn((table: string) => {
      const queue = remaining[table]
      if (!queue || queue.length === 0) {
        throw new Error(`Unexpected query for table ${table}`)
      }
      return chainResolving(queue.shift())
    }),
  })
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('dashboard overview route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/dashboard/overview?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/dashboard/overview?propertyId=property-1') as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})

describe('dashboard overview metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
  })

  it('scopes AI response rate to the property window and reports missing ad data', async () => {
    mockServiceClientWithQueues({
      // No ad platform rows for this property (current, then previous period).
      fact_marketing_performance: [{ data: [] }, { data: [] }],
      // Lead counts (current, previous), then recent leads list.
      leads: [{ count: 0 }, { count: 0 }, { data: [] }],
      // AI-rate window messages, then recent messages list.
      messages: [
        {
          data: [
            // Answered user message.
            { conversation_id: 'conv-1', role: 'user', created_at: daysAgoIso(5) },
            { conversation_id: 'conv-1', role: 'assistant', created_at: daysAgoIso(5) },
            // Unanswered user message in another conversation.
            { conversation_id: 'conv-2', role: 'user', created_at: daysAgoIso(2) },
            // Assistant greeting with no user message must not inflate the rate.
            { conversation_id: 'conv-3', role: 'assistant', created_at: daysAgoIso(1) },
          ],
        },
        { data: [] },
      ],
      documents: [{ count: 9 }],
    })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/dashboard/overview?propertyId=property-1') as NextRequest
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    // 1 of 2 user messages answered => 50%, never above 100.
    expect(json.metrics.aiResponseRate.value).toBe(50)
    // No spend data connected: CPL is null (not $0.00) and the UI is told why.
    expect(json.metrics.costPerLead.value).toBeNull()
    expect(json.metrics.totalSpend.value).toBe(0)
    expect(json.summary.hasMarketingData).toBe(false)
    expect(json.summary.impressions).toBe(0)
  })

  it('computes cost per lead and spend change when ad data exists', async () => {
    mockServiceClientWithQueues({
      fact_marketing_performance: [
        { data: [{ spend: 100, clicks: 40, conversions: 4, impressions: 1000 }, { spend: 200, clicks: 10, conversions: 1, impressions: 1000 }] },
        { data: [{ spend: 100, clicks: 25, conversions: 2, impressions: 500 }] },
      ],
      leads: [{ count: 10 }, { count: 5 }, { data: [] }],
      messages: [{ data: [] }, { data: [] }],
      documents: [{ count: 0 }],
    })

    const { GET } = await import('./route')
    const response = await GET(
      new Request('http://localhost/api/dashboard/overview?propertyId=property-1') as NextRequest
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.summary.hasMarketingData).toBe(true)
    // $300 spend / 10 leads.
    expect(json.metrics.costPerLead.value).toBe(30)
    // Previous CPL was $100 / 5 = $20, so CPL rose 50%.
    expect(json.metrics.costPerLead.change).toBe(50)
    expect(json.metrics.totalSpend.value).toBe(300)
    expect(json.metrics.totalLeads.value).toBe(10)
    expect(json.metrics.totalLeads.change).toBe(100)
    // No user messages in the window: rate is null, not a fake 100%.
    expect(json.metrics.aiResponseRate.value).toBeNull()
    expect(json.summary.ctr).toBe(2.5)
  })
})
