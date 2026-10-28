import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { scrapeCompetitor } from './scrape-client'
import { sendMarketDecision } from './decision-client'
vi.mock('./decision-client', () => ({sendMarketDecision: vi.fn()}))
const send = vi.mocked(sendMarketDecision)
const read = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', read)
  send.mockResolvedValue({result: {state: 'queued'}, execution: {paused: false}})
})
afterEach(() => vi.unstubAllGlobals())
function source(values = {}, paused = false) {
  read.mockResolvedValue(Response.json({competitor: {isActive: true, version: 7, website: 'https://example.com', ...values}, execution: {paused}}))
}
it('requests the current website version and permits a fresh intent after confirmation', async () => {
  source()
  expect(await scrapeCompetitor('property', 'competitor')).toContain('Scrape requested')
  expect(send).toHaveBeenCalledWith('/api/marketvision/sources', 'POST', expect.objectContaining({propertyId: 'property', competitorId: 'competitor', expectedVersion: 7, source: 'website'}), expect.any(Array), true)
})
it('uses the saved listing when no website exists', async () => {
  source({website: null, apartments_com: 'https://apartments.com/example'})
  await scrapeCompetitor('property', 'competitor')
  expect(send.mock.calls[0][2].source).toBe('apartments_com')
})
it.each([
  [{isActive: false}, false, 'archived'],
  [{website: null}, false, 'add a website'],
  [{}, true, 'paused'],
] as const)('does not submit unavailable sources', async (values, paused, message) => {
  source(values, paused)
  expect(await scrapeCompetitor('property', 'competitor')).toContain(message)
  expect(send).not.toHaveBeenCalled()
})
it('never submits after a failed source read', async () => {
  read.mockResolvedValue(Response.json({error: 'Access denied'}, {status: 403}))
  await expect(scrapeCompetitor('property', 'competitor')).rejects.toThrow('Access denied')
  expect(send).not.toHaveBeenCalled()
})
it('reports existing open work without claiming success', async () => {
  source()
  send.mockResolvedValue({result: {state: 'busy'}})
  expect(await scrapeCompetitor('property', 'competitor')).toContain('already open')
})
