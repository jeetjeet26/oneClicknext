import OpenAI from 'openai'
import { createServiceClient } from '@/utils/supabase/admin'

function formatEmbeddingForPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

export async function retrieveKbContext(args: {
  propertyId: string
  query: string
  matchCount?: number
  matchThreshold?: number
}): Promise<{ contextText: string; chunks: Array<{ content: string; similarity: number; metadata: unknown }> }> {
  const { propertyId, query } = args
  const matchCount = args.matchCount ?? 6
  const matchThreshold = args.matchThreshold ?? 0.45

  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) {
    return { contextText: '', chunks: [] }
  }

  const openai = new OpenAI({ apiKey: openaiKey })
  const supabase = createServiceClient()

  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query
  })
  const embedding = embeddingResponse.data[0].embedding

  const { data: documents, error } = await supabase.rpc('match_documents', {
    query_embedding: formatEmbeddingForPgVector(embedding),
    match_threshold: matchThreshold,
    match_count: matchCount,
    filter_property: propertyId
  })

  if (error || !documents) {
    return { contextText: '', chunks: [] }
  }

  const chunks: Array<{ content: string; similarity: number; metadata: unknown }> = (documents as Array<any>).map((d: any) => ({
    content: String(d.content ?? ''),
    similarity: Number(d.similarity ?? 0),
    metadata: d.metadata as unknown
  }))

  const contextText = chunks
    .map((c: { content: string; similarity: number }, idx: number) => `SOURCE ${idx + 1} (similarity ${c.similarity.toFixed(3)}):\n${c.content}`)
    .join('\n\n---\n\n')

  return { contextText, chunks }
}


