import { beforeEach, expect, it, vi } from 'vitest'
import type { AIRecommendation, RecommendationEvidence } from './recommendation-contracts'
const provider = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: provider.create } } } }))
import { groundedRecommendations, reviewedRecommendations, generateRecommendationAnalysis } from './recommendation-model'

const sources: RecommendationEvidence[] = [{ id: 'campaign:search', label: 'Google search', reference: 'campaign:google_ads:1:2', observedAt: '2026-11-26T12:00:00Z', data: { spend: 500, conversions: 0 } }]
const candidate: AIRecommendation = {
  title: 'Verify Search conversion measurement', priority: 'high', category: 'data',
  finding: 'Search reports $500 spend and zero provider-attributed conversions.', rationale: 'Recorded results do not establish whether inquiries occurred.',
  action: 'Test the inquiry conversion event before increasing spend.', steps: ['Submit a consented test inquiry and verify one corresponding event.'],
  targetMetric: 'Verified inquiry events', measurement: 'One test inquiry should produce one verified event before judging campaign CPA.',
  expectedImpact: 'Improves measurement reliability; business impact is unproven.', rollback: 'Remove the test event if duplicated.', confidence: 'medium',
  limitations: ['Zero reported conversions does not prove no real-world inquiries.'], evidenceIds: ['campaign:search'],
}
const response = (value: unknown, finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { content: JSON.stringify(value) } }] })
beforeEach(() => vi.clearAllMocks())
it('withholds unknown and duplicate citations without discarding other supported candidates', () => {
  const result = groundedRecommendations({ summary: 'Analysis', recommendations: [candidate, { ...candidate, evidenceIds: ['other-property'] }, { ...candidate, evidenceIds: ['campaign:search', 'campaign:search'] }] }, sources)
  expect(result.recommendations).toEqual([candidate]); expect(result.withheldCount).toBe(2)
})
it('rejects an incomplete or ambiguous independent review', () => {
  const yes = { index: 0, evidenceGrounded: true, actionable: true, appropriate: true, reason: 'Supported' }
  expect(() => reviewedRecommendations({ reviews: [] }, [candidate])).toThrow()
  expect(() => reviewedRecommendations({ reviews: [yes, yes] }, [candidate, candidate])).toThrow()
  expect(reviewedRecommendations({ reviews: [{ ...yes, evidenceGrounded: false }] }, [candidate])).toEqual([])
})
it('retains only independently supported recommendations and never publishes an unreviewed summary', async () => {
  provider.create.mockResolvedValueOnce(response({ summary: 'An unsupported claim of guaranteed sales', recommendations: [candidate] }))
    .mockResolvedValueOnce(response({ reviews: [{ index: 0, evidenceGrounded: true, actionable: true, appropriate: true, reason: 'Specific source-grounded measurement test' }] }))
  const result = await generateRecommendationAnalysis({ property: { name: 'Cayman', transaction: 'for_sale' }, start: '2026-10-01', end: '2026-10-31', sources })
  expect(result.recommendations).toEqual([candidate]); expect(result.summary).not.toContain('guaranteed')
  expect(provider.create).toHaveBeenCalledTimes(2)
  const sent = provider.create.mock.calls[0][0]
  expect(sent.messages[1].content).toContain('Cayman'); expect(sent.messages[1].content).toContain('campaign:search')
  expect(sent.messages[0].content).toContain('provider-attributed'); expect(sent.messages[0].content).toContain('untrusted data')
})
it('fails closed on a failed evidence review and incomplete provider output', async () => {
  provider.create.mockResolvedValueOnce(response({ summary: 'Analysis', recommendations: [candidate] })).mockRejectedValueOnce(new Error('Provider interrupted'))
  await expect(generateRecommendationAnalysis({ property: {}, start: '2026-10-01', end: '2026-10-31', sources })).rejects.toThrow()
  provider.create.mockResolvedValueOnce(response({}, 'length'))
  await expect(generateRecommendationAnalysis({ property: {}, start: '2026-10-01', end: '2026-10-31', sources })).rejects.toThrow('Incomplete')
})
it('allows an honestly empty result without inventing recommendations or preserving unsupported summary claims', async () => {
  provider.create.mockResolvedValueOnce(response({ summary: 'Guaranteed sales growth', recommendations: [] }))
  const result = await generateRecommendationAnalysis({ property: {}, start: '2026-10-01', end: '2026-10-31', sources: [] })
  expect(result.recommendations).toEqual([]); expect(result.summary).not.toContain('Guaranteed'); expect(provider.create).toHaveBeenCalledTimes(1)
})
