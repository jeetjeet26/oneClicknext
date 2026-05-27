import { beforeEach, describe, expect, it, vi } from 'vitest'
import { retrieveCompetitorKbContext } from './competitor-kb'

const retrieveKbContextMock = vi.hoisted(() => vi.fn())

vi.mock('@/utils/siteforge/kb', () => ({
  retrieveKbContext: retrieveKbContextMock,
}))

describe('retrieveCompetitorKbContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters property KB results to competitor intelligence documents', async () => {
    retrieveKbContextMock.mockResolvedValue({
      contextText: 'mixed',
      chunks: [
        {
          content: 'Competitor: Brookhaven\nPositioning: New homes in El Monte',
          similarity: 0.91,
          metadata: { source: 'competitor_intelligence' },
        },
        {
          content: 'General property document',
          similarity: 0.8,
          metadata: { source: 'manual' },
        },
      ],
    })

    const result = await retrieveCompetitorKbContext({
      propertyId: 'property-1',
      query: 'competitor positioning',
    })

    expect(result.competitorNames).toEqual(['Brookhaven'])
    expect(result.contextText).toContain('COMPETITOR SOURCE 1')
    expect(result.contextText).not.toContain('General property document')
    expect(retrieveKbContextMock).toHaveBeenCalledWith({
      propertyId: 'property-1',
      query: 'competitor positioning',
      matchCount: 12,
      matchThreshold: 0.35,
    })
  })
})
