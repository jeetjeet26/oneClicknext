import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Content sections cite property knowledge-base documents retrieved by vector
 * search at generation time, so their ids cannot be enumerated ahead of time
 * in the confirmed plan. This resolves every cited id against the
 * property-scoped documents table; only ids confirmed to exist are returned
 * and may be passed to the deterministic quality gates as trusted evidence.
 */
export async function verifyKnowledgeBaseEvidenceIds(
  client: SupabaseClient<Database>,
  propertyId: string,
  pages: ReadonlyArray<{
    sections: ReadonlyArray<{ evidenceIds?: string[] | null }>
  }>
): Promise<string[]> {
  const citedEvidenceIds = [
    ...new Set(
      pages.flatMap(page =>
        page.sections.flatMap(section => section.evidenceIds || [])
      )
    ),
  ].filter(evidenceId => UUID_PATTERN.test(evidenceId))
  if (citedEvidenceIds.length === 0) return []
  const { data, error } = await client
    .from('documents')
    .select('id')
    .eq('property_id', propertyId)
    .in('id', citedEvidenceIds)
  if (error) {
    throw new Error(
      `Failed to verify cited knowledge-base evidence: ${error.message}`
    )
  }
  return (data || []).map(row => row.id)
}
