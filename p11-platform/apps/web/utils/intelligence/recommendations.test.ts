import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ actor: vi.fn(), docs: vi.fn(), save: vi.fn(), scope: vi.fn(), current: vi.fn(), context: vi.fn(), portfolio: vi.fn(), facts: vi.fn(), research: vi.fn(), model: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/utils/community-brain/server', () => ({ resolveCommunityScope: m.scope, requireCurrentScope: m.current, getCommunityContext: m.context }))
vi.mock('@/utils/analytics/read-marketing-facts', () => ({ readMarketingFacts: m.facts }))
vi.mock('@/utils/marketvision/research-store', () => ({ researchWorkspace: m.research }))
vi.mock('./portfolio', () => ({ readPortfolio: m.portfolio }))
vi.mock('./recommendation-model', () => ({ generateRecommendationAnalysis: m.model }))
vi.mock('./store', () => ({ intelligenceActor: m.actor, readDocuments: m.docs, saveDocument: m.save,
  IntelligenceError: class extends Error { constructor(message: string, readonly status = 503) { super(message) } },
}))
import { recommendationContext, generatePropertyRecommendations } from './recommendations'
const propertyId = '11111111-1111-4111-8111-111111111111'
const row = { id: '1', date: '2026-10-04', channel_id: 'google_ads', source_account_id: '1234567890', currency_code: 'USD', campaign_id: '42', campaign_name: 'Cayman Search', impressions: 1000, clicks: 50, spend: 100, conversions: 2, raw_source: 'mcp_daily_v1' }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('OPENAI_API_KEY', 'test')
  m.actor.mockResolvedValue('actor'); m.docs.mockResolvedValue([]); m.current.mockResolvedValue(undefined)
  m.scope.mockResolvedValue({ id: 'scope', property_ids: [propertyId] })
  m.context.mockResolvedValue({ readSetHash: 'a'.repeat(64), canonical: { property: { settings: { onboarding: { transaction: 'for_sale' } } }, facts: [{ value: 'Approved community fact' }], floorplans: [], brand: null }, evidence: [] })
  m.portfolio.mockResolvedValue({ properties: [{ score: { id: propertyId, name: 'Cayman' }, coverage: [], market: { competitors: [], limited: false, note: 'No market-wide averages' } }], limitations: ['Recorded outcomes can be incomplete'] })
  m.facts.mockImplementation(async (_db: unknown, filters: { startDate: string }) => filters.startDate === '2026-10-01' ? [row] : [{ ...row, date: '2026-09-04', spend: 80 }])
  m.research.mockResolvedValue({ documents: [], result: null })
  m.model.mockResolvedValue({ summary: 'No supported recommendations', recommendations: [], model: 'test-model', withheldCount: 0 })
  m.save.mockImplementation(async (_actor: string, input: { payload: unknown; key: string }) => ({ document: { id: 'saved', key: input.key, payload: input.payload } }))
})
it('keeps campaign identity, previous-period baselines, knowledge and sale model in one property scope', async () => {
  const { input } = await recommendationContext('actor', propertyId, '2026-10-01', '2026-10-31')
  expect(input.property).toMatchObject({ id: propertyId, name: 'Cayman', model: { transaction: 'for_sale' } })
  const campaign = input.sources.find(s => s.id.startsWith('campaign:'))
  expect(campaign?.data).toMatchObject({ current: { campaign_id: '42', source_account_id: '1234567890', spend: 100 }, previous: { spend: 80 } })
  expect(m.portfolio).toHaveBeenCalledWith('2026-10-01', '2026-10-31', false, propertyId)
  expect(m.current).toHaveBeenCalledWith(expect.objectContaining({ id: 'scope' }), propertyId)
})
it('does not fetch data or call the model when generation access is denied', async () => {
  m.actor.mockRejectedValueOnce(new Error('Forbidden'))
  await expect(generatePropertyRecommendations(propertyId, '2026-10-01', '2026-10-31')).rejects.toThrow('Forbidden')
  expect(m.facts).not.toHaveBeenCalled(); expect(m.model).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled()
})
it('retains the exact source snapshot and model provenance in one native save after rechecking authority', async () => {
  const result = await generatePropertyRecommendations(propertyId, '2026-10-01', '2026-10-31')
  expect(result.reused).toBe(false)
  const [actor, command, options] = m.save.mock.calls[0]
  expect(actor).toBe('actor'); expect(options).toEqual({ aiGeneration: true })
  expect(command).toMatchObject({ propertyId, expectedRevision: 0, kind: 'recommendation', operation: 'save', payload: { generation: { version: 1, model: 'test-model', start: '2026-10-01', end: '2026-10-31', sources: expect.arrayContaining([expect.objectContaining({ id: 'knowledge:current' })]) } } })
  expect(m.actor).toHaveBeenCalledTimes(2)
  expect(m.current.mock.invocationCallOrder.at(-1)).toBeLessThan(m.save.mock.invocationCallOrder[0])
})
it('reuses the same evidence snapshot on retry without another model call or save', async () => {
  await generatePropertyRecommendations(propertyId, '2026-10-01', '2026-10-31')
  const command = m.save.mock.calls[0][1]
  m.docs.mockResolvedValue([{ id: 'saved', key: command.key, payload: command.payload }])
  const result = await generatePropertyRecommendations(propertyId, '2026-10-01', '2026-10-31')
  expect(result.reused).toBe(true); expect(m.model).toHaveBeenCalledTimes(1); expect(m.save).toHaveBeenCalledTimes(1)
})
it('never saves after a failed model review or a revoked scope', async () => {
  m.model.mockRejectedValueOnce(new Error('Evidence review failed'))
  await expect(generatePropertyRecommendations(propertyId, '2026-10-01', '2026-10-31')).rejects.toThrow()
  expect(m.save).not.toHaveBeenCalled()
  m.current.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Scope revoked'))
  await expect(generatePropertyRecommendations(propertyId, '2026-10-01', '2026-10-31')).rejects.toThrow('Scope revoked')
  expect(m.save).not.toHaveBeenCalled()
})
