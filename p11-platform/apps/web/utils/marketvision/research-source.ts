import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import { safePublicFetchWithMetadata } from '@/utils/services/safe-public-fetch'

export interface ResearchDocument {
  id: string
  entityKey: string
  url: string
  title: string
  fetchedAt: string
  kind: 'official' | 'listing' | 'planning' | 'reviews' | 'ads' | 'reference'
  status: 'captured' | 'failed'
  text: string
  contentHash: string
  metadata: {
    parser: string; transport: string; partial: boolean; error?: string
    links?: Array<{url: string; label: string}>
    images?: Array<{url: string; alt: string}>
    structuredData?: unknown[]; terms?: string; responseStatus?: number
  }
}
export function publicResearchUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$|^[\d.:\[\]]+$/i.test(url.hostname)) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid|fbclid|rcstdid|rccustomid)/i.test(key)) url.searchParams.delete(key)
    return url.href
  } catch { return null }
}
const normalize = (text: string) => text.replace(/\u00a0/g, ' ').replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
export function parseResearchHtml(body: string, url: string) {
  const $ = load(body)
  const title = $('title').first().text().trim()
  const rawText = normalize($('body').text())
  if (/web server is down|error\s*(?:code\s*)?(?:520|521|522|523|524)|access denied|just a moment|attention required/i.test(title) ||
    (rawText.length < 4000 && /cloudflare.{0,80}(?:error|ray id)|checking your browser|verify (?:that )?you are human|enable javascript and cookies/i.test(rawText))) throw new Error('Source returned an error or browser challenge')
  const structuredData: unknown[] = []
  $('script[type="application/ld+json"],script[type="application/json"]').each((_, element) => {
    const text = $(element).text()
    if (text.length <= 100000) try { structuredData.push(JSON.parse(text)) } catch { /* Preserve a parse failure as missing coverage. */ }
  })
  const links: Array<{url: string; label: string}> = []
  $('a[href]').each((_, el) => { const href = publicResearchUrl($(el).attr('href') ?? '', url); if (href && !links.some(v => v.url === href)) links.push({url:href,label:normalize($(el).text()).slice(0,200)}) })
  const images: Array<{url: string; alt: string}> = []
  $('img').each((_, el) => { const href = publicResearchUrl($(el).attr('data-src') || $(el).attr('src') || '', url); if (href && !images.some(v => v.url === href)) images.push({url:href,alt:($(el).attr('alt') || '').slice(0,400)}) })
  const terms = normalize($('footer, [class*="disclaimer"], [class*="legal"], [class*="terms"]').text()).slice(0,12000)
  $('script,style,noscript,template,svg,iframe,nav,header,form,select,footer,[role="navigation"],[hidden],[aria-hidden="true"]').remove()
  $('br,hr').replaceWith('\n')
  $('p,div,section,article,li,td,th,h1,h2,h3,h4,h5,h6').append('\n')
  const main = $('main,[role="main"]').first()
  const text = normalize(main.length ? main.text() : $('body').text())
  return {title,text,links:links.slice(0,300),images:images.slice(0,100),structuredData:structuredData.slice(0,12),terms}
}
export function researchLinkPriority(url: string): number {
  if (/floor.?plans?|residences|\/plan[-/]|\/mir\?|homesite|available|availability|inventory/i.test(url)) return 100
  if (/features|amenities|faq|special|offer|incentive|brochure|\.pdf/i.test(url)) return 90
  if (/gallery|photo|area|neighborhood|location|contact|sales-procedure|broker/i.test(url)) return 50
  return 0
}
/** A community path is a boundary. Corporate navigation and sibling communities are never auto-crawled. */
export function scopedResearchLinks(seed: string, links: Array<{url: string; label: string}>) {
  const root = new URL(seed), path = root.pathname.replace(/\/$/, '')
  return links.filter(link => {
    const url = new URL(link.url)
    return url.origin === root.origin && (path === '' || url.pathname === path || url.pathname.startsWith(`${path}/`)) &&
      !/privacy|terms-of-use|login|sign-?in|cart|checkout/i.test(url.pathname) && researchLinkPriority(link.url) > 0
  }).sort((a,b) => researchLinkPriority(b.url) - researchLinkPriority(a.url))
}
export async function fetchResearchDocument(entityKey: string, url: string, kind: ResearchDocument['kind'] = 'official'): Promise<ResearchDocument> {
  const id = crypto.randomUUID(), fetchedAt = new Date().toISOString()
  try {
    if (!publicResearchUrl(url)) throw new Error('Unsupported source address')
    const {response, finalUrl} = await safePublicFetchWithMetadata(url,{timeoutMs:20000,maxBytes:5000000,headers:{accept:'text/html,application/pdf,text/plain'}})
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer()), contentHash = createHash('sha256').update(bytes).digest('hex')
    const type = response.headers.get('content-type')?.split(';')[0].trim() || ''
    if (type === 'application/pdf') {
      const {extractText} = await import('unpdf')
      const extracted = await extractText(bytes,{mergePages:true})
      const text = normalize(String(extracted.text))
      return {id,entityKey,url:finalUrl,title:new URL(finalUrl).pathname.split('/').at(-1) || 'PDF',fetchedAt,kind,status:'captured',text:text.slice(0,80000),contentHash,metadata:{parser:'research-pdf-v1',transport:'public_http',partial:text.length>80000,responseStatus:response.status}}
    }
    if (!['text/html','application/xhtml+xml','text/plain'].includes(type)) throw new Error('Unsupported source format')
    const body = new TextDecoder('utf-8',{fatal:true}).decode(bytes)
    const parsed = type === 'text/plain' ? {title:'Public source',text:normalize(body),links:[],images:[],structuredData:[],terms:''} : parseResearchHtml(body,finalUrl)
    if (parsed.text.length < 50) throw new Error('Page has insufficient usable text; rendered content may be required')
    return {id,entityKey,url:finalUrl,title:parsed.title,fetchedAt,kind,status:'captured',text:parsed.text.slice(0,80000),contentHash,metadata:{parser:'research-html-v2',transport:'public_http',partial:parsed.text.length>80000,links:parsed.links,images:parsed.images,structuredData:parsed.structuredData,terms:parsed.terms,responseStatus:response.status}}
  } catch (error) {
    return {id,entityKey,url,title:'Source unavailable',fetchedAt,kind,status:'failed',text:'',contentHash:'',metadata:{parser:'research-html-v2',transport:'public_http',partial:true,error:error instanceof Error ? error.message.slice(0,250) : 'Source unavailable'}}
  }
}
