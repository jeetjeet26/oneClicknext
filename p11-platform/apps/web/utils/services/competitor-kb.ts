import { retrieveKbContext } from '@/utils/siteforge/kb'

export type CompetitorKbContext = {
  contextText: string
  competitorNames: string[]
  chunks: Array<{ content: string; similarity: number; metadata: unknown }>
}

function isCompetitorIntelligenceMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const source = (metadata as { source?: unknown }).source
  return source === 'competitor_intelligence'
}

function extractCompetitorName(content: string): string | null {
  const match = content.match(/^Competitor:\s*(.+)$/m)
  return match?.[1]?.trim() || null
}

export async function retrieveCompetitorKbContext(args: {
  propertyId: string
  query: string
  matchCount?: number
  matchThreshold?: number
}): Promise<CompetitorKbContext> {
  const result = await retrieveKbContext({
    propertyId: args.propertyId,
    query: args.query,
    matchCount: args.matchCount ?? 12,
    matchThreshold: args.matchThreshold ?? 0.35,
  })

  const competitorChunks = result.chunks.filter(chunk =>
    isCompetitorIntelligenceMetadata(chunk.metadata)
  )
  const competitorNames = Array.from(
    new Set(
      competitorChunks
        .map(chunk => extractCompetitorName(chunk.content))
        .filter((name): name is string => Boolean(name))
    )
  )

  return {
    contextText: competitorChunks
      .map((chunk, idx) => `COMPETITOR SOURCE ${idx + 1} (similarity ${chunk.similarity.toFixed(3)}):\n${chunk.content}`)
      .join('\n\n---\n\n'),
    competitorNames,
    chunks: competitorChunks,
  }
}
