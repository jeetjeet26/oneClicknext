import * as cheerio from 'cheerio'

export type PropertyScrapePageType =
  | 'home'
  | 'floorplans'
  | 'amenities'
  | 'neighborhood'
  | 'faq'
  | 'contact'
  | 'gallery'
  | 'pet_policy'
  | 'specials'
  | 'tour'
  | 'news'
  | 'prequalify'
  | 'unknown'

export interface PropertyScrapePage {
  url: string
  status: number | null
  reachable: boolean
  contentType: string | null
  fetchSource: 'direct' | 'reader' | null
  title: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  pageType: PropertyScrapePageType
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
  content: string
}

export interface PropertyScrapeStructuredData {
  propertyName?: string
  amenities: string[]
  features: string[]
  unitTypes: string[]
  specials: string[]
  contactInfo?: {
    phone?: string
    email?: string
    address?: string
    officeHours?: string
  }
  petPolicy?: {
    petsAllowed: boolean
    deposit?: number
    monthlyRent?: number
    weightLimitLbs?: number
    maxPets?: number
    breedRestrictions?: boolean
    details?: string[]
  }
  pricingPageUrls: string[]
  floorplanPageUrls: string[]
  availabilityUrls: string[]
  prequalifyUrls: string[]
  galleryUrls: string[]
  newsUrls: string[]
  neighborhoodSummary?: string
}

export interface CentralizedPropertyScrapeResult {
  seedUrl: string
  origin: string
  scopeUrl: string
  scopePath: string
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
  pages: PropertyScrapePage[]
  discoveredUrls: string[]
  acceptedUrls: string[]
  filteredOutUrls: string[]
  blockedUrls: string[]
  missingPageTypes: PropertyScrapePageType[]
  crawlSummary: {
    pagesAttempted: number
    pagesAudited: number
    discoverySources: string[]
    maxPages: number
  }
  structured: PropertyScrapeStructuredData
  rawChunks: string[]
  chunkSourceUrls: string[]
}

type FetchedPage = {
  ok: boolean
  status: number | null
  body: string | null
  contentType: string | null
  source: 'direct' | 'reader' | null
}

const DEFAULT_MAX_PAGES = 25
const FETCH_TIMEOUT_MS = 8000
const IMPORTANT_PAGE_TYPES: PropertyScrapePageType[] = ['floorplans', 'amenities', 'neighborhood', 'faq', 'contact']
const IGNORED_EXTENSIONS = /\.(?:avif|css|docx?|gif|ico|jpe?g|js|json|mp4|pdf|png|svg|webm|webp|xlsx?|xml|zip)$/i

const PROPERTY_PAGE_SEGMENTS = new Set([
  'amenity',
  'amenities',
  'features',
  'floor-plan',
  'floor-plans',
  'floorplans',
  'plans',
  'availability',
  'available-homes',
  'homes',
  'gallery',
  'photos',
  'contact',
  'contact-us',
  'community',
  'neighborhood',
  'location',
  'faq',
  'faqs',
  'pet-policy',
  'pets',
  'specials',
  'news',
  'blog',
  'prequalify',
  'schedule-a-tour',
  'tour',
  'virtual-tour',
])

const SCOPED_REAL_ESTATE_SUFFIXES = [
  '',
  'features',
  'amenities',
  'floor-plans',
  'floorplans',
  'availability',
  'available-homes',
  'community',
  'neighborhood',
  'location',
  'contact-us',
  'contact',
  'gallery',
  'gallery/community',
  'photos',
  'pet-policy',
  'specials',
  'news',
  'prequalify',
  'faq',
  'faqs',
  'schedule-a-tour',
]

const AMENITY_KEYWORDS = [
  'pool', 'fitness', 'gym', 'dog park', 'pet park', 'clubhouse',
  'business center', 'playground', 'tennis', 'basketball', 'volleyball',
  'bbq', 'grill', 'fire pit', 'rooftop', 'parking garage', 'ev charging',
  'package locker', 'concierge', 'theater', 'game room', 'spa', 'sauna',
  'yoga', 'co-working', 'coworking', 'pet spa', 'bike storage', 'storage',
  'laundry', 'washer', 'dryer', 'dishwasher', 'granite', 'stainless',
  'balcony', 'patio', 'fireplace', 'hardwood', 'walk-in closet',
  'ceiling fan', 'air conditioning', 'central heat', 'gated', 'security',
]

export function normalizePropertyScrapeUrl(input: string | null | undefined): URL | null {
  if (!input || typeof input !== 'string' || input.trim().length === 0) return null
  try {
    return new URL(input)
  } catch {
    try {
      return new URL(`https://${input}`)
    } catch {
      return null
    }
  }
}

export function derivePropertyScope(seedUrl: URL): { scopeUrl: string; scopePath: string; slug: string | null } {
  const segments = seedUrl.pathname
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)

  let scopeSegments = segments
  const firstPageSegmentIndex = segments.findIndex((segment, index) =>
    index > 0 && PROPERTY_PAGE_SEGMENTS.has(segment.toLowerCase())
  )
  if (firstPageSegmentIndex > 0) {
    scopeSegments = segments.slice(0, firstPageSegmentIndex)
  }

  const scopePath = scopeSegments.length > 0 ? `/${scopeSegments.join('/')}/` : '/'
  const scopeUrl = new URL(scopePath, seedUrl.origin).toString()
  return {
    scopeUrl,
    scopePath,
    slug: scopeSegments.at(-1)?.toLowerCase() || null,
  }
}

export async function scrapePropertyWebsite(
  websiteUrl: string | null | undefined,
  options: { maxPages?: number; propertyName?: string | null; additionalUrls?: string[] } = {}
): Promise<CentralizedPropertyScrapeResult | null> {
  const seed = normalizePropertyScrapeUrl(websiteUrl)
  if (!seed || !isSafePublicUrl(seed)) return null

  seed.hash = ''
  seed.search = ''
  const maxPages = options.maxPages || DEFAULT_MAX_PAGES
  const originUrl = new URL(seed.origin)
  const scope = derivePropertyScope(seed)
  const notes: string[] = []

  const seedFetch = await fetchPage(seed.toString())
  const robots = await fetchDirectText(new URL('/robots.txt', originUrl).toString(), 5000)
  const sitemap = await fetchDirectText(new URL('/sitemap.xml', originUrl).toString(), 5000)
  const llms = await fetchDirectText(new URL('/llms.txt', originUrl).toString(), 5000)

  if (!seedFetch.ok) notes.push('The public property seed page was not reachable during the URL-only audit.')
  if (!robots.ok) notes.push('robots.txt was not reachable.')
  if (!sitemap.ok) notes.push('sitemap.xml was not reachable.')
  if (!llms.ok) notes.push('llms.txt was not reachable.')

  const discoverySources = new Set<string>(['seed_url'])
  const candidates = new Map<string, string>()
  const filteredOut = new Set<string>()

  const addCandidate = (rawUrl: string | null, source: string) => {
    if (!rawUrl) return
    const normalized = normalizeSameOriginUrl(rawUrl, seed)
    if (!normalized) return
    if (isUrlInPropertyScope(normalized, scope.scopePath, scope.slug, options.propertyName)) {
      candidates.set(normalized, source)
      discoverySources.add(source)
    } else {
      filteredOut.add(normalized)
    }
  }

  addCandidate(seed.toString(), 'seed_url')
  for (const sitemapUrl of extractSitemapUrls(sitemap.body, originUrl)) addCandidate(sitemapUrl, 'sitemap.xml')
  for (const linkedUrl of extractInternalLinks(seedFetch.body, seed)) addCandidate(linkedUrl, 'homepage_links')
  for (const scopedUrl of buildScopedSuffixUrls(scope.scopeUrl)) addCandidate(scopedUrl, 'property_scoped_paths')
  for (const explicitUrl of options.additionalUrls || []) addCandidate(explicitUrl, 'explicit_urls')

  const pages: PropertyScrapePage[] = []
  const blockedUrls = new Set<string>()
  const queued = Array.from(candidates.keys())
  const seen = new Set<string>()

  for (let index = 0; index < queued.length && pages.length < maxPages; index += 1) {
    const pageUrl = queued[index]
    if (seen.has(pageUrl)) continue
    seen.add(pageUrl)

    const fetched = pageUrl === seed.toString() ? seedFetch : await fetchPage(pageUrl)
    if (!fetched.ok) blockedUrls.add(pageUrl)
    const audited = auditScrapedPage(pageUrl, fetched, originUrl.origin)
    pages.push(audited)

    if (audited.reachable && fetched.source === 'direct') {
      for (const linkedUrl of extractInternalLinks(fetched.body, new URL(pageUrl))) {
        const normalized = normalizeSameOriginUrl(linkedUrl, seed)
        if (!normalized || seen.has(normalized) || queued.includes(normalized)) continue
        if (isUrlInPropertyScope(normalized, scope.scopePath, scope.slug, options.propertyName)) {
          queued.push(normalized)
          candidates.set(normalized, 'scoped_page_links')
          discoverySources.add('scoped_page_links')
        } else {
          filteredOut.add(normalized)
        }
      }
    }
  }

  const reachablePages = pages.filter(page => page.reachable)
  const seedAudit = pages.find(page => page.url === seed.toString()) || reachablePages[0] || null
  const structuredDataTypes = Array.from(new Set(reachablePages.flatMap(page => page.structuredDataTypes))).sort()
  const coveredPageTypes = new Set(reachablePages.map(page => page.pageType))
  if (reachablePages.some(pageCountsAsFaqCoverage)) coveredPageTypes.add('faq')
  const missingPageTypes = IMPORTANT_PAGE_TYPES.filter(pageType => !coveredPageTypes.has(pageType))

  if (seedFetch.ok && !seedAudit?.metaDescription) notes.push('Property seed page meta description is missing.')
  if (seedFetch.ok && structuredDataTypes.length === 0) notes.push('No JSON-LD structured data was detected on audited pages.')
  if (reachablePages.reduce((sum, page) => sum + page.answerBlockSignals, 0) === 0) {
    notes.push('No obvious FAQ or answer-block signals were found on audited pages.')
  }
  missingPageTypes.forEach(pageType => {
    notes.push(`No reachable ${pageType.replace('_', ' ')} page was detected during the property-scoped crawl.`)
  })

  const structured = buildStructuredData(reachablePages)
  const { rawChunks, chunkSourceUrls } = buildChunks(reachablePages)

  return {
    seedUrl: seed.toString(),
    origin: seed.origin,
    scopeUrl: scope.scopeUrl,
    scopePath: scope.scopePath,
    homepageReachable: seedFetch.ok,
    robotsTxtReachable: robots.ok,
    sitemapReachable: sitemap.ok,
    llmsTxtReachable: llms.ok,
    title: seedAudit?.title || null,
    metaDescription: seedAudit?.metaDescription || null,
    structuredDataTypes,
    faqStructuredData: reachablePages.some(page => page.faqStructuredData),
    organizationStructuredData: reachablePages.some(page => page.organizationStructuredData),
    answerBlockSignals: reachablePages.reduce((sum, page) => sum + page.answerBlockSignals, 0),
    internalLinkCount: seedAudit?.internalLinkCount || 0,
    notes,
    pages,
    discoveredUrls: Array.from(candidates.keys()).slice(0, maxPages),
    acceptedUrls: pages.map(page => page.url),
    filteredOutUrls: Array.from(filteredOut).sort(),
    blockedUrls: Array.from(blockedUrls).sort(),
    missingPageTypes,
    crawlSummary: {
      pagesAttempted: pages.length,
      pagesAudited: reachablePages.length,
      discoverySources: Array.from(discoverySources).sort(),
      maxPages,
    },
    structured,
    rawChunks,
    chunkSourceUrls,
  }
}

function isSafePublicUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const normalized = url.hostname.toLowerCase()
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return false
  if (normalized === '0.0.0.0' || normalized === '::1' || normalized === '[::1]') return false
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized)) return false
  const private172 = normalized.match(/^172\.(\d+)\./)
  if (!private172) return true
  const secondOctet = Number(private172[1])
  return secondOctet < 16 || secondOctet > 31
}

function buildReaderUrl(url: string): string {
  return `https://r.jina.ai/${url}`
}

async function fetchDirectText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<FetchedPage> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PropertyAudit/1.0; +https://oneclick)',
      },
    })
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text().catch(() => null),
      contentType: response.headers.get('content-type'),
      source: response.ok ? 'direct' : null,
    }
  } catch {
    return { ok: false, status: null, body: null, contentType: null, source: null }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchPage(url: string): Promise<FetchedPage> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        body: await response.text(),
        contentType: response.headers.get('content-type'),
        source: 'direct',
      }
    }
  } catch {
    // Try reader fallback below.
  }

  try {
    const readerResponse = await fetch(buildReaderUrl(url), {
      headers: {
        Accept: 'text/plain,text/markdown,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; oneClickBot/1.0; +https://oneclick.local)',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!readerResponse.ok) {
      return {
        ok: false,
        status: readerResponse.status,
        body: await readerResponse.text().catch(() => null),
        contentType: readerResponse.headers.get('content-type'),
        source: null,
      }
    }
    return {
      ok: true,
      status: readerResponse.status,
      body: await readerResponse.text(),
      contentType: readerResponse.headers.get('content-type') || 'text/plain',
      source: 'reader',
    }
  } catch {
    return { ok: false, status: null, body: null, contentType: null, source: null }
  }
}

function normalizeSameOriginUrl(rawHref: string, baseUrl: URL): string | null {
  if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return null
  try {
    const url = new URL(rawHref, baseUrl)
    if (url.origin !== baseUrl.origin) return null
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (IGNORED_EXTENSIONS.test(url.pathname)) return null
    url.hash = ''
    url.search = ''
    return url.toString()
  } catch {
    return null
  }
}

function isUrlInPropertyScope(url: string, scopePath: string, slug: string | null, propertyName?: string | null): boolean {
  try {
    const parsed = new URL(url)
    const path = ensureTrailingSlash(parsed.pathname)
    if (scopePath === '/') return true
    if (path === scopePath || path.startsWith(scopePath)) return true

    const lower = path.toLowerCase()
    const normalizedPropertyName = propertyName?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    return Boolean(
      (slug && lower.split('/').includes(slug)) ||
      (normalizedPropertyName && normalizedPropertyName.length > 2 && lower.includes(normalizedPropertyName))
    )
  } catch {
    return false
  }
}

function ensureTrailingSlash(pathname: string): string {
  if (!pathname || pathname === '/') return '/'
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

function buildScopedSuffixUrls(scopeUrl: string): string[] {
  return SCOPED_REAL_ESTATE_SUFFIXES.map(suffix => new URL(suffix, scopeUrl).toString())
}

function extractSitemapUrls(sitemapXml: string | null, baseUrl: URL): string[] {
  if (!sitemapXml) return []
  const $ = cheerio.load(sitemapXml, { xmlMode: true })
  const urls = new Set<string>()
  $('url > loc, sitemap > loc').each((_, element) => {
    const normalized = normalizeSameOriginUrl($(element).text().trim(), baseUrl)
    if (normalized) urls.add(normalized)
  })
  return Array.from(urls)
}

function extractInternalLinks(html: string | null, baseUrl: URL): string[] {
  if (!html) return []
  const $ = cheerio.load(html)
  const urls = new Set<string>()
  $('a[href]').each((_, element) => {
    const normalized = normalizeSameOriginUrl($(element).attr('href') || '', baseUrl)
    if (normalized) urls.add(normalized)
  })
  return Array.from(urls)
}

function auditScrapedPage(url: string, fetched: FetchedPage, origin: string): PropertyScrapePage {
  if (!fetched.ok || !fetched.body) {
    return {
      url,
      status: fetched.status,
      reachable: false,
      contentType: fetched.contentType,
      fetchSource: fetched.source,
      title: null,
      metaDescription: null,
      canonicalUrl: null,
      pageType: 'unknown',
      wordCount: 0,
      h1: [],
      h2: [],
      structuredDataTypes: [],
      jsonLdParseErrors: 0,
      faqStructuredData: false,
      organizationStructuredData: false,
      answerBlockSignals: 0,
      internalLinkCount: 0,
      signals: [],
      evidenceSnippets: [],
      content: '',
    }
  }

  const isPlainText = fetched.source === 'reader'
  const $ = cheerio.load(fetched.body)
  const content = isPlainText ? extractTextFromPlainText(fetched.body) : extractTextFromHtml($)
  const title = isPlainText ? extractTitleFromPlainText(fetched.body) : $('title').first().text().trim() || null
  const metaDescription = isPlainText ? null : $('meta[name="description"]').attr('content')?.trim() || null
  const canonicalUrl = isPlainText ? null : $('link[rel="canonical"]').attr('href')?.trim() || null
  const h1 = isPlainText ? [] : $('h1').toArray().map(element => $(element).text().replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3)
  const h2 = isPlainText ? [] : $('h2').toArray().map(element => $(element).text().replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8)
  const structuredData = isPlainText ? { types: [] as string[], parseErrors: 0 } : extractStructuredData($)
  const pageType = classifyPage(new URL(url), title, content)
  const internalLinkCount = isPlainText ? 0 : $('a[href]')
    .toArray()
    .filter(element => Boolean(normalizeSameOriginUrl($(element).attr('href') || '', new URL(origin))))
    .length
  const answerBlockSignals = isPlainText
    ? (content.match(/\?/g) || []).slice(0, 5).length
    : $('h2, h3').toArray().filter(element => ($(element).text() || '').includes('?')).length +
      $('[itemtype*="FAQPage"], [class*="faq" i], [id*="faq" i], details summary').length

  return {
    url,
    status: fetched.status,
    reachable: true,
    contentType: fetched.contentType,
    fetchSource: fetched.source,
    title,
    metaDescription,
    canonicalUrl,
    pageType,
    wordCount: content ? content.split(/\s+/).length : 0,
    h1,
    h2,
    structuredDataTypes: structuredData.types,
    jsonLdParseErrors: structuredData.parseErrors,
    faqStructuredData: structuredData.types.includes('FAQPage'),
    organizationStructuredData:
      structuredData.types.includes('Organization') ||
      structuredData.types.includes('ApartmentComplex') ||
      structuredData.types.includes('Residence') ||
      structuredData.types.includes('LocalBusiness'),
    answerBlockSignals,
    internalLinkCount,
    signals: extractSignals(pageType, content),
    evidenceSnippets: extractEvidenceSnippets(content),
    content,
  }
}

function extractStructuredData($: cheerio.CheerioAPI): { types: string[]; parseErrors: number } {
  const types = new Set<string>()
  let parseErrors = 0
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text()
    if (!raw) return
    try {
      collectSchemaTypes(JSON.parse(raw), types)
    } catch {
      parseErrors += 1
    }
  })
  return { types: Array.from(types).sort(), parseErrors }
}

function collectSchemaTypes(value: unknown, types: Set<string>, depth = 0) {
  if (depth > 20 || value === null) return
  if (Array.isArray(value)) {
    value.forEach(item => collectSchemaTypes(item, types, depth + 1))
    return
  }
  if (typeof value !== 'object') return
  const record = value as Record<string, unknown>
  const typeValue = record['@type']
  if (typeof typeValue === 'string') types.add(typeValue)
  if (Array.isArray(typeValue)) typeValue.forEach(type => { if (typeof type === 'string') types.add(type) })
  Object.values(record).forEach(child => collectSchemaTypes(child, types, depth + 1))
}

function extractTextFromHtml($: cheerio.CheerioAPI): string {
  const clone = $.root().clone()
  clone.find('script, style, nav, header, footer, noscript').remove()
  return clone.text().replace(/\s+/g, ' ').trim()
}

function extractTitleFromPlainText(text: string): string | null {
  const titleMatch = text.match(/^Title:\s*(.+)$/im)
  if (titleMatch) return titleMatch[1].replace(/\s+/g, ' ').trim()
  const headingMatch = text.match(/^#\s+(.+)$/m)
  return headingMatch ? headingMatch[1].replace(/\s+/g, ' ').trim() : null
}

function extractTextFromPlainText(text: string): string {
  return text
    .replace(/^Title:\s*.+$/gim, '')
    .replace(/^URL Source:\s*.+$/gim, '')
    .replace(/^Markdown Content:\s*/gim, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^[#>*\-\s]+/gm, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 3)
    .join('\n')
}

function classifyPage(url: URL, title: string | null, text: string): PropertyScrapePageType {
  const path = url.pathname.toLowerCase()
  const haystack = `${path} ${title || ''} ${text.slice(0, 2500)}`.toLowerCase()
  if (path === '/' || path === '') return 'home'
  if (/(?:^|\/)(?:faqs?|frequently-asked-questions?)(?:\/|$)/.test(path)) return 'faq'
  if (/(?:^|\/)(?:amenities?|features)(?:\/|$)/.test(path)) return 'amenities'
  if (/(?:^|\/)(?:neighborhood|location|nearby|directions|community)(?:\/|$)/.test(path)) return 'neighborhood'
  if (/(?:^|\/)(?:contact|contact-us)(?:\/|$)/.test(path)) return 'contact'
  if (/(?:^|\/)(?:gallery|photos?|images)(?:\/|$)/.test(path)) return 'gallery'
  if (/(?:^|\/)(?:pet-policy|pets?)(?:\/|$)/.test(path)) return 'pet_policy'
  if (/(?:^|\/)(?:specials?|offers?)(?:\/|$)/.test(path)) return 'specials'
  if (/(?:^|\/)(?:schedule-a-tour|tour|visit|virtual-tour)(?:\/|$)/.test(path)) return 'tour'
  if (/(?:^|\/)(?:news|blog)(?:\/|$)/.test(path)) return 'news'
  if (/(?:^|\/)(?:prequalify|pre-qualify|qualification)(?:\/|$)/.test(path)) return 'prequalify'
  if (/(?:^|\/)(?:floorplans?|floor-plans?|plans?|apartments?|homes?|townhomes?|condos?|availability|pricing)(?:\/|$)/.test(path)) return 'floorplans'
  if (/floor[-_ ]?plans?|apartments?|homes?|townhomes?|condos?|availability|pricing/.test(haystack)) return 'floorplans'
  if (/amenit|features/.test(haystack)) return 'amenities'
  if (/neighborhood|location|nearby|directions|map|community/.test(haystack)) return 'neighborhood'
  if (/faq|frequently asked|questions/.test(haystack)) return 'faq'
  if (/contact|office hours|phone|email/.test(haystack)) return 'contact'
  if (/gallery|photos?|images/.test(haystack)) return 'gallery'
  if (/pet[-_ ]?policy|pets?|dog|cat/.test(haystack)) return 'pet_policy'
  if (/specials?|concession|move[-_ ]?in|free rent|offer/.test(haystack)) return 'specials'
  if (/prequalif|pre-qualif/.test(haystack)) return 'prequalify'
  if (/tour|schedule|visit/.test(haystack)) return 'tour'
  return 'unknown'
}

function pageCountsAsFaqCoverage(page: PropertyScrapePage): boolean {
  if (page.pageType === 'faq' || page.faqStructuredData) return true
  try {
    if (/(?:^|\/)(?:faqs?|frequently-asked-questions?)(?:\/|$)/.test(new URL(page.url).pathname.toLowerCase())) return true
  } catch {
    return false
  }
  return page.answerBlockSignals >= 3
}

function extractSignals(pageType: PropertyScrapePageType, text: string): string[] {
  const signals = new Set<string>()
  const lower = text.toLowerCase()
  if (pageType !== 'unknown') signals.add(pageType)
  if (/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(text)) signals.add('phone')
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text)) signals.add('email')
  if (/studio|one bedroom|two bedroom|three bedroom|\d+\s*(?:bed|br|bedroom)/i.test(text)) signals.add('unit_mix')
  if (/\$\d+|rent|pricing|availability/.test(lower)) signals.add('pricing_or_availability')
  if (/pool|fitness|gym|clubhouse|parking|dog park|package|coworking|co-working/.test(lower)) signals.add('amenity_details')
  if (/near|nearby|walk|downtown|school|employer|restaurant|transit/.test(lower)) signals.add('local_context')
  if (/apply|application|lease|income|deposit|prequalif/.test(lower)) signals.add('leasing_process')
  return Array.from(signals).sort()
}

function extractEvidenceSnippets(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 40)
  const priority = sentences.filter(sentence =>
    /rent|price|floor plan|amenit|feature|pet|tour|neighborhood|location|apply|special|parking|prequalif/i.test(sentence)
  )
  return [...priority, ...sentences].slice(0, 3).map(sentence => sentence.slice(0, 220))
}

function buildStructuredData(pages: PropertyScrapePage[]): PropertyScrapeStructuredData {
  const amenities = new Set<string>()
  const features = new Set<string>()
  const unitTypes = new Set<string>()
  const specials = new Set<string>()
  const pricingPageUrls = new Set<string>()
  const floorplanPageUrls = new Set<string>()
  const availabilityUrls = new Set<string>()
  const prequalifyUrls = new Set<string>()
  const galleryUrls = new Set<string>()
  const newsUrls = new Set<string>()
  let propertyName: string | undefined
  let contactInfo: PropertyScrapeStructuredData['contactInfo']
  let petPolicy: PropertyScrapeStructuredData['petPolicy']
  let neighborhoodSummary: string | undefined

  for (const page of pages) {
    if (!propertyName && page.title) propertyName = cleanPropertyName(page.title)
    extractAmenities(page.content).forEach(value => amenities.add(value))
    extractFeatures(page.content).forEach(value => features.add(value))
    extractUnitTypes(page.content).forEach(value => unitTypes.add(value))
    extractSpecials(page.content).forEach(value => specials.add(value))

    if (page.pageType === 'floorplans' || page.signals.includes('pricing_or_availability')) {
      pricingPageUrls.add(page.url)
      floorplanPageUrls.add(page.url)
    }
    if (/availability/i.test(page.url)) availabilityUrls.add(page.url)
    if (page.pageType === 'prequalify') prequalifyUrls.add(page.url)
    if (page.pageType === 'gallery') galleryUrls.add(page.url)
    if (page.pageType === 'news') newsUrls.add(page.url)
    if (!petPolicy) petPolicy = extractPetPolicy(page.content)
    contactInfo = mergeContactInfo(contactInfo, extractContactInfo(page.content))
    if (!neighborhoodSummary && page.pageType === 'neighborhood') {
      neighborhoodSummary = page.evidenceSnippets[0]
    }
  }

  return {
    propertyName,
    amenities: Array.from(amenities).slice(0, 30),
    features: Array.from(features).slice(0, 30),
    unitTypes: Array.from(unitTypes).sort(),
    specials: Array.from(specials).slice(0, 8),
    contactInfo,
    petPolicy,
    pricingPageUrls: Array.from(pricingPageUrls),
    floorplanPageUrls: Array.from(floorplanPageUrls),
    availabilityUrls: Array.from(availabilityUrls),
    prequalifyUrls: Array.from(prequalifyUrls),
    galleryUrls: Array.from(galleryUrls),
    newsUrls: Array.from(newsUrls),
    neighborhoodSummary,
  }
}

function cleanPropertyName(title: string): string {
  return title
    .replace(/\s*(?:\||-)\s*(?:Apartments|Apartment Homes|New Homes|Home|Official Site).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim() || title.trim()
}

function extractAmenities(content: string): string[] {
  const amenities = new Set<string>()
  const lower = content.toLowerCase()
  AMENITY_KEYWORDS.forEach(keyword => {
    if (lower.includes(keyword)) amenities.add(keyword.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
  })
  return Array.from(amenities)
}

function extractFeatures(content: string): string[] {
  const matches = content.match(/\b(?:smart home|energy efficient|gated|garage|solar|open[- ]concept|new homes?|townhomes?|private yard|walk[- ]in closet|stainless steel|quartz|granite)\b/gi) || []
  return Array.from(new Set(matches.map(match => match.replace(/\s+/g, ' ').trim())))
}

function extractUnitTypes(content: string): string[] {
  const unitTypes = new Set<string>()
  const lower = content.toLowerCase()
  if (lower.includes('studio')) unitTypes.add('Studio')
  for (const match of lower.matchAll(/(\d+)\s*(?:bed|br|bedroom)/gi)) unitTypes.add(`${match[1]} Bedroom`)
  const nums: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5' }
  for (const match of lower.matchAll(/\b(one|two|three|four|five)\s*bedroom/gi)) unitTypes.add(`${nums[match[1].toLowerCase()]} Bedroom`)
  return Array.from(unitTypes).sort()
}

function extractSpecials(content: string): string[] {
  const specials: string[] = []
  const patterns = [
    /(\$\d+\s*off[^.!]*[.!])/gi,
    /(\d+\s*(?:month|week)s?\s*free[^.!]*[.!])/gi,
    /(free\s*(?:month|rent|application)[^.!]*[.!])/gi,
    /(waived?\s*(?:fee|deposit|application)[^.!]*[.!])/gi,
    /(move.?in\s*special[^.!]*[.!])/gi,
  ]
  patterns.forEach(pattern => {
    for (const match of content.matchAll(pattern)) {
      const cleaned = match[1].replace(/\s+/g, ' ').trim()
      if (cleaned.length > 10) specials.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1))
    }
  })
  return Array.from(new Set(specials))
}

function extractPetPolicy(content: string): PropertyScrapeStructuredData['petPolicy'] | undefined {
  const lower = content.toLowerCase()
  if (!lower.includes('pet') && !lower.includes('dog') && !lower.includes('cat')) return undefined
  if (['no pets', 'pets not allowed', 'pet-free', 'no animals'].some(phrase => lower.includes(phrase))) {
    return { petsAllowed: false }
  }
  const policy: NonNullable<PropertyScrapeStructuredData['petPolicy']> = { petsAllowed: true, details: [] }
  const depositMatch = lower.match(/\$(\d+)\s*(?:pet\s*)?deposit/i)
  if (depositMatch) policy.deposit = Number(depositMatch[1])
  const rentMatch = lower.match(/\$(\d+)\s*(?:monthly|month|\/mo)?\s*pet\s*rent/i)
  if (rentMatch) policy.monthlyRent = Number(rentMatch[1])
  const weightMatch = lower.match(/(\d+)\s*(?:lb|pound)s?\s*(?:limit|max|weight)/i)
  if (weightMatch) policy.weightLimitLbs = Number(weightMatch[1])
  const limitMatch = lower.match(/(\d+)\s*pets?\s*(?:max|maximum|limit|allowed)/i)
  if (limitMatch) policy.maxPets = Number(limitMatch[1])
  if (lower.includes('breed restriction') || lower.includes('restricted breed')) policy.breedRestrictions = true
  return policy
}

function extractContactInfo(content: string): PropertyScrapeStructuredData['contactInfo'] | undefined {
  const contact: NonNullable<PropertyScrapeStructuredData['contactInfo']> = {}
  const phoneMatch = content.match(/(?:phone|tel|call)[:\s]*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i) || content.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)
  if (phoneMatch) contact.phone = phoneMatch[1] || phoneMatch[0]
  const emailMatch = content.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  if (emailMatch && !emailMatch[0].toLowerCase().includes('example')) contact.email = emailMatch[0]
  const hoursMatch = content.match(/(?:office\s*hours|hours)[:\s]*([^\n]{10,100})/i)
  if (hoursMatch) contact.officeHours = hoursMatch[1].replace(/\s+/g, ' ').trim()
  return Object.keys(contact).length > 0 ? contact : undefined
}

function mergeContactInfo(
  current: PropertyScrapeStructuredData['contactInfo'],
  next: PropertyScrapeStructuredData['contactInfo']
): PropertyScrapeStructuredData['contactInfo'] {
  if (!next) return current
  return {
    phone: current?.phone || next.phone,
    email: current?.email || next.email,
    address: current?.address || next.address,
    officeHours: current?.officeHours || next.officeHours,
  }
}

function buildChunks(pages: PropertyScrapePage[]): { rawChunks: string[]; chunkSourceUrls: string[] } {
  const rawChunks: string[] = []
  const chunkSourceUrls: string[] = []
  pages.forEach(page => {
    for (const chunk of chunkContent(page.content)) {
      rawChunks.push(`[Source URL: ${page.url} | Page Type: ${page.pageType}]\n${chunk}`)
      chunkSourceUrls.push(page.url)
    }
  })
  return { rawChunks, chunkSourceUrls }
}

function chunkContent(content: string, maxSize = 800, overlap = 100): string[] {
  const chunks: string[] = []
  const sentences = content.split(/(?<=[.!?])\s+/)
  let currentChunk = ''
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      const words = currentChunk.split(' ')
      currentChunk = `${words.slice(-Math.floor(overlap / 5)).join(' ')} ${sentence}`
    } else {
      currentChunk += `${currentChunk ? ' ' : ''}${sentence}`
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim())
  return chunks.filter(chunk => chunk.length > 50)
}
