import 'server-only'
import OpenAI from 'openai'
import { brainRpc, requireCurrentScope } from './server'
import type { CommunityScope } from './contracts'

/** One bounded embedding intent per authorized query/cache window. Provider
 * uncertainty falls back to lexical retrieval; it never repeats a paid intent. */
export async function prepareCommunityQuery(scope: CommunityScope, propertyId: string, query: string) {
  if (!query.trim() || !process.env.OPENAI_API_KEY) return
  const intent = await brainRpc<{ id?: string; state: string }>('brain_prepare_query', {
    p_scope_id: scope.id, p_property_id: propertyId, p_query: query,
  })
  if (intent.state !== 'invoke_once') return
  try {
    await requireCurrentScope(scope, propertyId)
    const response = await new OpenAI({ maxRetries: 0, timeout: 15_000 }).embeddings.create({
      model: 'text-embedding-3-small', dimensions: 1536, input: query, encoding_format: 'float',
    })
    const vector = response.data[0]?.embedding
    if (response.model !== 'text-embedding-3-small' || vector?.length !== 1536 || vector.some(n => !Number.isFinite(n))) throw new Error('Invalid embedding namespace')
    await brainRpc('brain_finish_query', { p_scope_id: scope.id, p_id: intent.id, p_model: response.model, p_embedding: JSON.stringify(vector) })
  } catch {
    await brainRpc('brain_finish_query', { p_scope_id: scope.id, p_id: intent.id, p_model: 'text-embedding-3-small', p_embedding: null }).catch(() => undefined)
    await requireCurrentScope(scope, propertyId)
  }
}
