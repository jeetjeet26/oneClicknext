type RagClient = {
  from: (table: string) => unknown
}

export type RagDocument = {
  id?: string
  content: string
  metadata?: unknown
}

const KEYWORD_TRIGGER_TERMS = new Set([
  'feature',
  'features',
  'finish',
  'finishes',
  'amenity',
  'amenities',
  'home',
  'homes',
  'school',
  'schools',
  'deposit',
  'deposits',
  'hoa',
  'pricing',
  'price',
  'prices',
  'plan',
  'plans',
])

const STOPWORDS = new Set([
  'about',
  'hello',
  'there',
  'thanks',
  'please',
  'tell',
  'what',
  'with',
  'your',
])

function normalizeKeywordTerms(query: string): string[] {
  const rawTerms = query
    .toLowerCase()
    .match(/[a-z0-9]+/g) || []

  const terms = new Set<string>()
  for (const term of rawTerms) {
    if (term.length < 3 || STOPWORDS.has(term)) continue
    terms.add(term)
    if (term.endsWith('s') && term.length > 4) {
      terms.add(term.slice(0, -1))
    }
  }

  return Array.from(terms).filter(term => KEYWORD_TRIGGER_TERMS.has(term)).slice(0, 6)
}

function buildIlikeFilters(terms: string[]): string {
  return terms
    .flatMap(term => [
      `content.ilike.%${term}%`,
      `original_file_name.ilike.%${term}%`,
    ])
    .join(',')
}

export async function fetchKeywordFallbackDocuments(
  supabase: RagClient,
  propertyId: string,
  query: string,
  existingDocuments: RagDocument[] = [],
  limit = 3
): Promise<RagDocument[]> {
  const terms = normalizeKeywordTerms(query)
  if (terms.length === 0) return []

  const documentsTable = supabase.from('documents') as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        or: (filters: string) => {
          limit: (count: number) => Promise<{ data: unknown[] | null; error?: unknown }>
        }
      }
    }
  }
  const existingIds = new Set(existingDocuments.map(doc => doc.id).filter(Boolean))
  const { data, error } = await documentsTable
    .select('id, content, metadata')
    .eq('property_id', propertyId)
    .or(buildIlikeFilters(terms))
    .limit(limit)

  if (error || !Array.isArray(data)) return []

  return data
    .map((doc) => doc as RagDocument)
    .filter(doc => typeof doc.content === 'string' && doc.content.trim().length > 0)
    .filter(doc => !doc.id || !existingIds.has(doc.id))
}

export function buildRagContext(documents: RagDocument[]): string {
  return documents
    .map((doc) => {
      const metadata = doc.metadata && typeof doc.metadata === 'object' ? doc.metadata as { title?: unknown; source?: unknown } : null
      const title = typeof metadata?.title === 'string'
        ? metadata.title
        : typeof metadata?.source === 'string'
          ? metadata.source
          : null
      return title ? `[Source: ${title}]\n${doc.content}` : doc.content
    })
    .filter(content => typeof content === 'string' && content.trim().length > 0)
    .join('\n---\n')
}
