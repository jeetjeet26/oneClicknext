import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const deps = vi.hoisted(() => ({ client: vi.fn(), llm: vi.fn(), lead: vi.fn(), calendar: vi.fn(), saveMessage: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient: deps.client }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: deps.llm } } } }))
vi.mock('@/utils/services/lead-upsert', () => ({ upsertLeadByContact: deps.lead }))
vi.mock('@/utils/services/google-calendar', () => ({ getCalendarConfig: deps.calendar }))
vi.mock('@/utils/services/rate-limiter', () => ({
  chatLimiter: { check: () => ({ allowed: true }) }, leadLimiter: { check: () => ({ allowed: true }) },
  tourLimiter: { check: () => ({ allowed: true }) }, getRateLimitKey: () => 'test', rateLimitHeaders: () => ({}),
}))
vi.mock('@/utils/services/audit-logger', () => ({ auditLog: vi.fn(), getRequestIp: () => '127.0.0.1' }))

const sessionId = '11111111-1111-4111-8111-111111111111'
const conversationId = '22222222-2222-4222-8222-222222222222'
const propertyId = '33333333-3333-4333-8333-333333333333'
type Options = { stale?: boolean; sessionError?: boolean; conversationError?: boolean; saveError?: boolean; missingSave?: boolean; otherSession?: boolean; missingSession?: boolean }
function clientFixture(options: Options = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  const from = vi.fn((table: string) => {
    let result: { data: unknown; error: unknown } = { data: null, error: null }
    if (table === 'lumaleasing_config') result.data = { property_id: propertyId, tours_enabled: true, properties: { name: 'Fixture community' } }
    if (table === 'widget_sessions') result = {
      data: options.missingSession ? null : { id: sessionId, message_count: 1, last_activity_at: new Date(Date.now() - (options.stale ? 49 : 1) * 3600000).toISOString() },
      error: options.sessionError ? { message: 'storage unavailable' } : null,
    }
    if (table === 'conversations') result = {
      data: { id: conversationId, widget_session_id: options.otherSession ? 'another-session' : sessionId, is_human_mode: true },
      error: options.conversationError ? { message: 'storage unavailable' } : null,
    }
    if (table === 'messages') result = { data: options.missingSave ? null : { id: 'saved' }, error: options.saveError ? { message: 'save unavailable' } : null }
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'order', 'limit', 'update', 'insert']) query[method] = vi.fn((...args: unknown[]) => { calls.push({ table, method, args }); return query })
    query.single = query.maybeSingle = vi.fn().mockResolvedValue(result)
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return query
  })
  return { from, calls }
}
async function request(kind: 'chat' | 'lead' | 'tours') {
  const route = kind === 'chat' ? await import('@/app/api/lumaleasing/chat/route')
    : kind === 'lead' ? await import('@/app/api/lumaleasing/lead/route') : await import('@/app/api/lumaleasing/tours/route')
  const body = kind === 'chat' ? { sessionId, messages: [{ role: 'user', content: 'Are tours available?' }] }
    : kind === 'lead' ? { sessionId, conversationId, email: 'fixture@example.invalid' }
      : { sessionId, conversationId, date: '2099-09-15', time: '10:00', leadInfo: { email: 'fixture@example.invalid' } }
  return route.POST(new Request(`http://localhost/api/lumaleasing/${kind}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': 'fixture-key' }, body: JSON.stringify(body),
  }) as NextRequest)
}

beforeEach(() => {vi.clearAllMocks();deps.saveMessage.mockReset().mockResolvedValue({saved:true,human:false,id:'message-saved',modeRevision:0})})
describe('public widget session mutation boundaries', () => {
  it.each(['chat', 'lead', 'tours'] as const)('rejects an expired %s session before lead, model or calendar actions', async kind => {
    const client = clientFixture({ stale: true }); deps.client.mockReturnValue(client)
    const response = await request(kind)
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ code: 'session_expired' })
    expect(client.calls.some(call => ['insert', 'update'].includes(call.method))).toBe(false)
    expect(deps.llm).not.toHaveBeenCalled(); expect(deps.lead).not.toHaveBeenCalled(); expect(deps.calendar).not.toHaveBeenCalled()
  })
  it.each(['chat', 'lead', 'tours'] as const)('reports %s storage failure without treating the session as missing', async kind => {
    deps.client.mockReturnValue(clientFixture({ sessionError: true }))
    expect((await request(kind)).status).toBe(500)
    expect(deps.lead).not.toHaveBeenCalled(); expect(deps.llm).not.toHaveBeenCalled()
  })
  it.each(['lead', 'tours'] as const)('rejects a %s conversation from another session in the same property', async kind => {
    deps.client.mockReturnValue(clientFixture({ otherSession: true }))
    expect((await request(kind)).status).toBe(400)
    expect(deps.lead).not.toHaveBeenCalled(); expect(deps.calendar).not.toHaveBeenCalled()
  })
  it.each([{ conversationError: true }, { saveError: true }, { missingSave: true }])('does not confirm a failed human handoff: %j', async options => {
    deps.client.mockReturnValue(clientFixture(options))
    if('saveError'in options||'missingSave'in options)deps.saveMessage.mockRejectedValue(new Error('Could not confirm saved message'))
    const response = await request('chat')
    expect(response.status).toBe(500)
    expect(await response.json()).not.toHaveProperty('waitingForHuman')
    expect(deps.llm).not.toHaveBeenCalled()
  })
  it('confirms a stored human handoff without calling the model', async () => {
    const client = clientFixture(); deps.client.mockReturnValue(client)
    const response = await request('chat')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ isHumanMode: true, waitingForHuman: true })
    expect(client.calls).toContainEqual({ table: 'conversations', method: 'eq', args: ['property_id', propertyId] })
    expect(deps.llm).not.toHaveBeenCalled()
  })
})

// Route cases exercise validation and user-facing behavior. Durable admission,
// atomic message writes and budgets have their own contract/real-DB suites.
vi.mock('@/utils/services/luma-requests', () => ({
  withLumaRequest: (req: NextRequest,_operation:string,handler:(req:NextRequest)=>Promise<Response>)=>handler(req),
  saveLumaMessage: deps.saveMessage,
  linkLumaVisitorLead: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/utils/services/luma-ai-budget', () => ({
  budgetedLumaCompletion: (openai:{chat:{completions:{create:(params:unknown)=>unknown}}},_db:unknown,_propertyId:string,params:unknown)=>openai.chat.completions.create(params),
}))
