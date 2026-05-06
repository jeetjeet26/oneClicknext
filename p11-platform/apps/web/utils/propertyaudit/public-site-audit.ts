import * as cheerio from 'cheerio'

export type PublicSitePageType =
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
  | 'unknown'

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
  crawlSummary?: {
    pagesAttempted: number
    pagesAudited: number
    discoverySources: string[]
    maxPages: number
  }
}

const DEFAULT_MAX_PAGES = 25
const FETCH_TIMEOUT_MS = 8000
const COMMON_APARTMENT_PATHS = [
  '/',
  '/floorplans',
  '/floor-plans',
  '/apartments',
  '/amenities',
  '/neighborhood',
  '/location',
  '/faq',
  '/faqs',
  '/contact',
  '/gallery',
  '/photos',
  '/pet-policy',
  '/specials',
  '/schedule-a-tour',
  '/tour',
]
const IMPORTANT_PAGE_TYPES: PublicSitePageType[] = ['floorplans', 'amenities', 'neighborhood', 'faq', 'contact']
const IGNORED_EXTENSIONS = /\.(?:avif|css|docx?|gif|ico|jpe?g|js|json|mp4|pdf|png|svg|webm|webp|xlsx?|xml|zip)$/i

function normalizeUrl(input: string | null | undefined): URL | null {
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
    crawlSummary: {
      pagesAttempted: 0,
      pagesAudited: 0,
      discoverySources: [],
      maxPages: DEFAULT_MAX_PAGES,
    },
  }
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true
  if (normalized === '0.0.0.0' || normalized === '::1' || normalized === '[::1]') return true
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized)) return true
  const private172 = normalized.match(/^172\.(\d+)\./)
  if (private172) {
    const secondOctet = Number(private172[1])
    return secondOctet >= 16 && secondOctet <= 31
  }
  return false
}

function normalizeSameOriginUrl(rawHref: string, baseUrl: URL): string | null {
  if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
    return null
  }

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

async function fetchText(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<{ ok: boolean; status: number | null; text: string | null; contentType: string | null }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PropertyAudit/1.0; +https://oneclick)',
      },
    })
    const text = await response.text().catch(() => null)
    return {
      ok: response.ok,
      status: response.status,
      text,
      contentType: response.headers.get('content-type'),
    }
  } catch {
    return { ok: false, status: null, text: null, contentType: null }
  } finally {
    clearTimeout(timeoutId)
  }
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
  if (typeof typeValue === 'string') {
    types.add(typeValue)
  } else if (Array.isArray(typeValue)) {
    typeValue.forEach(type => {
      if (typeof type === 'string') types.add(type)
    })
  }

  Object.values(record).forEach(child => collectSchemaTypes(child, types, depth + 1))
}

function extractStructuredData($: cheerio.CheerioAPI): { types: string[]; parseErrors: number } {
  const types = new Set<string>()
  let parseErrors = 0
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text()
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      collectSchemaTypes(parsed, types)
    } catch {
      parseErrors += 1
    }
  })
  return { types: Array.from(types).sort(), parseErrors }
}

function extractText($: cheerio.CheerioAPI): string {
  const clone = $.root().clone()
  clone.find('script, style, nav, header, footer, noscript').remove()
  return clone
    .text()
    .replace(/\s+/g, ' ')
    .trim()
}

function extractEvidenceSnippets(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 40)

  const priority = sentences.filter(sentence =>
    /rent|price|floor plan|amenit|pet|tour|neighborhood|location|apply|special|parking/i.test(sentence)
  )
  return [...priority, ...sentences].slice(0, 3).map(sentence => sentence.slice(0, 220))
}

function classifyPage(url: URL, title: string | null, text: string): PublicSitePageType {
  const path = url.pathname.toLowerCase()
  const haystack = `${path} ${title || ''} ${text.slice(0, 2500)}`.toLowerCase()

  if (path === '/' || path === '') return 'home'
  if (pathLooksLikeFaq(path)) return 'faq'
  if (/floor[-_ ]?plans?|apartments?|availability|pricing/.test(haystack)) return 'floorplans'
  if (/amenit|features/.test(haystack)) return 'amenities'
  if (/neighborhood|location|nearby|directions|map/.test(haystack)) return 'neighborhood'
  if (/faq|frequently asked|questions/.test(haystack)) return 'faq'
  if (/contact|office hours|phone|email/.test(haystack)) return 'contact'
  if (/gallery|photos?|images/.test(haystack)) return 'gallery'
  if (/pet[-_ ]?policy|pets?|dog|cat/.test(haystack)) return 'pet_policy'
  if (/specials?|concession|move[-_ ]?in|free rent|offer/.test(haystack)) return 'specials'
  if (/tour|schedule|visit/.test(haystack)) return 'tour'
  return 'unknown'
}

function pathLooksLikeFaq(path: string): boolean {
  return /(?:^|\/)(?:faqs?|frequently-asked-questions?)(?:\/|$)/.test(path)
}

function pageCountsAsFaqCoverage(page: PublicSitePageAudit): boolean {
  if (page.pageType === 'faq' || page.faqStructuredData) return true
  try {
    if (pathLooksLikeFaq(new URL(page.url).pathname.toLowerCase())) return true
  } catch {
    // Ignore malformed URLs in crawl evidence; they should not block the audit.
  }
  return page.answerBlockSignals >= 3
}

function extractSignals(pageType: PublicSitePageType, text: string): string[] {
  const signals = new Set<string>()
  const lower = text.toLowerCase()
  if (pageType !== 'unknown') signals.add(pageType)
  if (/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(text)) signals.add('phone')
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text)) signals.add('email')
  if (/studio|one bedroom|two bedroom|three bedroom|\d+\s*(?:bed|br|bedroom)/i.test(text)) signals.add('unit_mix')
  if (/\$\d+|rent|pricing|availability/.test(lower)) signals.add('pricing_or_availability')
  if (/pool|fitness|gym|clubhouse|parking|dog park|package|coworking|co-working/.test(lower)) signals.add('amenity_details')
  if (/near|nearby|walk|downtown|school|employer|restaurant|transit/.test(lower)) signals.add('local_context')
  if (/apply|application|lease|income|deposit/.test(lower)) signals.add('leasing_process')
  return Array.from(signals).sort()
}

function auditPage(url: string, fetched: Awaited<ReturnType<typeof fetchText>>, origin: string): PublicSitePageAudit | null {
  if (!fetched.ok || !fetched.text) {
    return {
      url,
      status: fetched.status,
      reachable: false,
      contentType: fetched.contentType,
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
    }
  }

  const $ = cheerio.load(fetched.text)
  const text = extractText($)
  const title = $('title').first().text().trim() || null
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || null
  const canonicalUrl = $('link[rel="canonical"]').attr('href')?.trim() || null
  const h1 = $('h1').toArray().map(element => $(element).text().replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3)
  const h2 = $('h2').toArray().map(element => $(element).text().replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8)
  const structuredData = extractStructuredData($)
  const parsedUrl = new URL(url)
  const pageType = classifyPage(parsedUrl, title, text)
  const internalLinkCount = $('a[href]')
    .toArray()
    .filter(element => {
      const href = $(element).attr('href') || ''
      const normalized = normalizeSameOriginUrl(href, new URL(origin))
      return Boolean(normalized)
    }).length
  const answerBlockSignals =
    $('h2, h3')
      .toArray()
      .filter(element => ($(element).text() || '').includes('?')).length +
    $('[itemtype*="FAQPage"], [class*="faq" i], [id*="faq" i], details summary').length

  return {
    url,
    status: fetched.status,
    reachable: true,
    contentType: fetched.contentType,
    title,
    metaDescription,
    canonicalUrl,
    pageType,
    wordCount: text ? text.split(/\s+/).length : 0,
    h1,
    h2,
    structuredDataTypes: structuredData.types,
    jsonLdParseErrors: structuredData.parseErrors,
    faqStructuredData: structuredData.types.includes('FAQPage'),
    organizationStructuredData:
      structuredData.types.includes('Organization') || structuredData.types.includes('ApartmentComplex'),
    answerBlockSignals,
    internalLinkCount,
    signals: extractSignals(pageType, text),
    evidenceSnippets: extractEvidenceSnippets(text),
  }
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
    const href = $(element).attr('href') || ''
    const normalized = normalizeSameOriginUrl(href, baseUrl)
    if (normalized) urls.add(normalized)
  })
  return Array.from(urls)
}

export async function auditPublicSite(websiteUrl: string | null | undefined): Promise<PublicSiteAudit> {
  const url = normalizeUrl(websiteUrl)
  if (!url) {
    return emptyAudit(websiteUrl || null, 'No public website URL is configured for this property.')
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || isPrivateOrLocalHost(url.hostname)) {
    return emptyAudit(websiteUrl || null, 'The configured website URL is not safe for URL-only auditing.')
  }

  const originUrl = new URL(url.origin)
  const homepage = await fetchText(url.toString())
  const robots = await fetchText(new URL('/robots.txt', originUrl).toString(), 5000)
  const sitemap = await fetchText(new URL('/sitemap.xml', originUrl).toString(), 5000)
  const llms = await fetchText(new URL('/llms.txt', originUrl).toString(), 5000)

  const notes: string[] = []
  if (!homepage.ok) {
    notes.push('The public homepage was not reachable during the URL-only audit.')
  }

  if (!robots.ok) notes.push('robots.txt was not reachable.')
  if (!sitemap.ok) notes.push('sitemap.xml was not reachable.')
  if (!llms.ok) notes.push('llms.txt was not reachable.')

  const discoverySources = new Set<string>(['homepage'])
  const discovered = new Set<string>([url.toString()])
  for (const sitemapUrl of extractSitemapUrls(sitemap.text, originUrl)) {
    discovered.add(sitemapUrl)
    discoverySources.add('sitemap.xml')
  }
  for (const linkedUrl of extractInternalLinks(homepage.text, url)) {
    discovered.add(linkedUrl)
    discoverySources.add('homepage_links')
  }
  for (const path of COMMON_APARTMENT_PATHS) {
    discovered.add(new URL(path, originUrl).toString())
    discoverySources.add('apartment_path_fallbacks')
  }

  const urlsToAudit = Array.from(discovered).slice(0, DEFAULT_MAX_PAGES)
  const pages: PublicSitePageAudit[] = []
  for (const pageUrl of urlsToAudit) {
    const fetched = pageUrl === url.toString() ? homepage : await fetchText(pageUrl)
    const audited = auditPage(pageUrl, fetched, originUrl.origin)
    if (audited) pages.push(audited)
  }

  const reachablePages = pages.filter(page => page.reachable)
  const homepageAudit = pages.find(page => page.url === url.toString()) || reachablePages[0] || null
  const structuredDataTypes = Array.from(new Set(reachablePages.flatMap(page => page.structuredDataTypes))).sort()
  const faqStructuredData = reachablePages.some(page => page.faqStructuredData)
  const organizationStructuredData = reachablePages.some(page => page.organizationStructuredData)
  const answerBlockSignals = reachablePages.reduce((sum, page) => sum + page.answerBlockSignals, 0)
  const internalLinkCount = homepageAudit?.internalLinkCount || 0
  const coveredPageTypes = new Set(reachablePages.map(page => page.pageType))
  if (reachablePages.some(pageCountsAsFaqCoverage)) {
    coveredPageTypes.add('faq')
  }
  const missingPageTypes = IMPORTANT_PAGE_TYPES.filter(pageType => !coveredPageTypes.has(pageType))

  if (homepage.ok && !homepageAudit?.metaDescription) notes.push('Homepage meta description is missing.')
  if (homepage.ok && structuredDataTypes.length === 0) notes.push('No JSON-LD structured data was detected on audited pages.')
  if (homepage.ok && answerBlockSignals === 0) notes.push('No obvious FAQ or answer-block signals were found on audited pages.')
  missingPageTypes.forEach(pageType => {
    notes.push(`No reachable ${pageType.replace('_', ' ')} page was detected during the URL-only crawl.`)
  })

  return {
    accessMode: 'URLOnly',
    websiteUrl: url.toString(),
    normalizedOrigin: url.origin,
    homepageReachable: homepage.ok,
    robotsTxtReachable: robots.ok,
    sitemapReachable: sitemap.ok,
    llmsTxtReachable: llms.ok,
    title: homepageAudit?.title || null,
    metaDescription: homepageAudit?.metaDescription || null,
    structuredDataTypes,
    faqStructuredData,
    organizationStructuredData,
    answerBlockSignals,
    internalLinkCount,
    notes,
    pages,
    discoveredUrls: urlsToAudit,
    missingPageTypes,
    crawlSummary: {
      pagesAttempted: urlsToAudit.length,
      pagesAudited: reachablePages.length,
      discoverySources: Array.from(discoverySources).sort(),
      maxPages: DEFAULT_MAX_PAGES,
    },
  }
}
