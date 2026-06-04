import {
  derivePropertyScope,
  normalizePropertyScrapeUrl,
  scrapePropertyWebsite,
  type PropertyScrapePage,
  type PropertyScrapePageType,
} from '@/utils/property-scrape/centralized-property-scrape'

export type PublicSitePageType = PropertyScrapePageType

export interface PublicSitePageAudit {
  url: string
  status: number | null
  reachable: boolean
  contentType: string | null
  title: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  pageType: PublicSitePageType
  wordCount: number
  h1: string[]
  h2: string[]
  structuredDataTypes: string[]
  jsonLdParseErrors: number
  faqStructuredData: boolean
  organizationStructuredData: boolean
  answerBlockSignals: number
  internalLinkCount: number
  signals: string[]
  evidenceSnippets: string[]
}

export interface PublicSiteAudit {
  accessMode: 'URLOnly'
  websiteUrl: string | null
  normalizedOrigin: string | null
  homepageReachable: boolean
  robotsTxtReachable: boolean
  sitemapReachable: boolean
  llmsTxtReachable: boolean
  title: string | null
  metaDescription: string | null
  structuredDataTypes: string[]
  faqStructuredData: boolean
  organizationStructuredData: boolean
  answerBlockSignals: number
  internalLinkCount: number
  notes: string[]
  pages?: PublicSitePageAudit[]
  discoveredUrls?: string[]
  missingPageTypes?: PublicSitePageType[]
  filteredOutUrls?: string[]
  crawlSummary?: {
    pagesAttempted: number
    pagesAudited: number
    discoverySources: string[]
    maxPages: number
  }
}

const DEFAULT_MAX_PAGES = 25
const IMPORTANT_PAGE_TYPES: PublicSitePageType[] = ['floorplans', 'amenities', 'neighborhood', 'faq', 'contact']

function emptyAudit(websiteUrl: string | null, note: string): PublicSiteAudit {
  return {
    accessMode: 'URLOnly',
    websiteUrl,
    normalizedOrigin: null,
    homepageReachable: false,
    robotsTxtReachable: false,
    sitemapReachable: false,
    llmsTxtReachable: false,
    title: null,
    metaDescription: null,
    structuredDataTypes: [],
    faqStructuredData: false,
    organizationStructuredData: false,
    answerBlockSignals: 0,
    internalLinkCount: 0,
    notes: [note],
    pages: [],
    discoveredUrls: [],
    missingPageTypes: IMPORTANT_PAGE_TYPES,
    filteredOutUrls: [],
    crawlSummary: {
      pagesAttempted: 0,
      pagesAudited: 0,
      discoverySources: [],
      maxPages: DEFAULT_MAX_PAGES,
    },
  }
}

function toAuditPage(page: PropertyScrapePage): PublicSitePageAudit {
  const { fetchSource: _fetchSource, content: _content, ...auditPage } = page
  void _fetchSource
  void _content
  return auditPage
}

export async function auditPublicSite(websiteUrl: string | null | undefined): Promise<PublicSiteAudit> {
  const scrape = await scrapePropertyWebsite(websiteUrl)
  if (!scrape) {
    return emptyAudit(
      websiteUrl || null,
      websiteUrl
        ? 'The configured website URL is not safe for URL-only auditing.'
        : 'No public website URL is configured for this property.'
    )
  }

  return {
    accessMode: 'URLOnly',
    websiteUrl: scrape.seedUrl,
    normalizedOrigin: scrape.origin,
    homepageReachable: scrape.homepageReachable,
    robotsTxtReachable: scrape.robotsTxtReachable,
    sitemapReachable: scrape.sitemapReachable,
    llmsTxtReachable: scrape.llmsTxtReachable,
    title: scrape.title,
    metaDescription: scrape.metaDescription,
    structuredDataTypes: scrape.structuredDataTypes,
    faqStructuredData: scrape.faqStructuredData,
    organizationStructuredData: scrape.organizationStructuredData,
    answerBlockSignals: scrape.answerBlockSignals,
    internalLinkCount: scrape.internalLinkCount,
    notes: scrape.notes,
    pages: scrape.pages.map(toAuditPage),
    discoveredUrls: scrape.discoveredUrls,
    missingPageTypes: scrape.missingPageTypes,
    filteredOutUrls: scrape.filteredOutUrls,
    crawlSummary: scrape.crawlSummary,
  }
}

type CachedAuditSourceRow = {
  source_url?: string | null
  extracted_data?: unknown
  last_synced_at?: string | null
}

type CachedAuditQueryBuilder = {
  select: (columns: string) => CachedAuditQueryBuilder
  eq: (column: string, value: string) => CachedAuditQueryBuilder
  order: (column: string, options: { ascending: boolean }) => CachedAuditQueryBuilder
  limit: (count: number) => CachedAuditQueryBuilder
  maybeSingle: () => Promise<{ data: CachedAuditSourceRow | null; error: unknown }>
}

type SupabaseLike = {
  from: (table: string) => CachedAuditQueryBuilder
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function cachedPageToAudit(page: Record<string, unknown>): PublicSitePageAudit {
  return {
    url: typeof page.url === 'string' ? page.url : '',
    status: typeof page.status === 'number' ? page.status : null,
    reachable: Boolean(page.reachable),
    contentType: null,
    title: typeof page.title === 'string' ? page.title : null,
    metaDescription: typeof page.meta_description === 'string' ? page.meta_description : null,
    canonicalUrl: typeof page.canonical_url === 'string' ? page.canonical_url : null,
    pageType: typeof page.page_type === 'string' ? page.page_type as PublicSitePageType : 'unknown',
    wordCount: typeof page.word_count === 'number' ? page.word_count : 0,
    h1: asStringArray(page.h1),
    h2: asStringArray(page.h2),
    structuredDataTypes: asStringArray(page.structured_data_types),
    jsonLdParseErrors: typeof page.json_ld_parse_errors === 'number' ? page.json_ld_parse_errors : 0,
    faqStructuredData: Boolean(page.faq_structured_data),
    organizationStructuredData: Boolean(page.organization_structured_data),
    answerBlockSignals: typeof page.answer_block_signals === 'number' ? page.answer_block_signals : 0,
    internalLinkCount: typeof page.internal_link_count === 'number' ? page.internal_link_count : 0,
    signals: asStringArray(page.signals),
    evidenceSnippets: asStringArray(page.evidence_snippets),
  }
}

function auditFromCachedSource(
  websiteUrl: string,
  extractedData: unknown
): PublicSiteAudit | null {
  if (!extractedData || typeof extractedData !== 'object') return null
  const crawl = (extractedData as Record<string, unknown>).crawl
  if (!crawl || typeof crawl !== 'object') return null
  const record = crawl as Record<string, unknown>
  const pageInventory = Array.isArray(record.page_inventory) ? record.page_inventory : []
  const pages = pageInventory
    .filter((page): page is Record<string, unknown> => Boolean(page) && typeof page === 'object')
    .map(cachedPageToAudit)
    .filter(page => page.url)
  if (pages.length === 0) return null

  const reachablePages = pages.filter(page => page.reachable)
  const seedPage = pages[0] || null
  const structuredDataTypes = Array.from(new Set(reachablePages.flatMap(page => page.structuredDataTypes))).sort()
  return {
    accessMode: 'URLOnly',
    websiteUrl,
    normalizedOrigin: typeof record.origin === 'string' ? record.origin : null,
    homepageReachable: reachablePages.length > 0,
    robotsTxtReachable: true,
    sitemapReachable: asStringArray(record.discovery_sources).includes('sitemap.xml'),
    llmsTxtReachable: false,
    title: seedPage?.title || null,
    metaDescription: seedPage?.metaDescription || null,
    structuredDataTypes,
    faqStructuredData: reachablePages.some(page => page.faqStructuredData),
    organizationStructuredData: reachablePages.some(page => page.organizationStructuredData),
    answerBlockSignals: reachablePages.reduce((sum, page) => sum + page.answerBlockSignals, 0),
    internalLinkCount: seedPage?.internalLinkCount || 0,
    notes: [
      'Using cached property-scoped website crawl from the knowledge base.',
      ...asStringArray(record.missing_page_types).map(type => `No reachable ${type.replace('_', ' ')} page was detected during the property-scoped crawl.`),
    ],
    pages,
    discoveredUrls: asStringArray(record.discovered_urls),
    missingPageTypes: asStringArray(record.missing_page_types) as PublicSitePageType[],
    filteredOutUrls: asStringArray(record.filtered_out_urls),
    crawlSummary: {
      pagesAttempted: typeof record.pages_attempted === 'number' ? record.pages_attempted : pages.length,
      pagesAudited: typeof record.pages_scraped === 'number' ? record.pages_scraped : reachablePages.length,
      discoverySources: asStringArray(record.discovery_sources),
      maxPages: DEFAULT_MAX_PAGES,
    },
  }
}

export async function auditPublicSiteForProperty(
  supabase: SupabaseLike,
  propertyId: string,
  websiteUrl: string | null | undefined
): Promise<PublicSiteAudit> {
  const seed = normalizePropertyScrapeUrl(websiteUrl)
  if (!seed) return auditPublicSite(websiteUrl)
  const scope = derivePropertyScope(seed)

  try {
    const { data, error } = await supabase
      .from('knowledge_sources')
      .select('source_url, extracted_data, last_synced_at')
      .eq('property_id', propertyId)
      .eq('source_type', 'website')
      .eq('source_url', scope.scopeUrl)
      .order('last_synced_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error && data?.extracted_data) {
      const cachedAudit = auditFromCachedSource(scope.scopeUrl, data.extracted_data)
      if (cachedAudit) return cachedAudit
    }
  } catch (error) {
    console.error('Failed to read cached public site audit:', error)
  }

  return auditPublicSite(websiteUrl)
}
