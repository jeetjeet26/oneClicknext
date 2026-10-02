import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import { safePublicFetchWithMetadata, UnsafePublicUrl } from '@/utils/services/safe-public-fetch'

export type SourceReceipt = {
  status: 'received' | 'failed' | 'uncertain'
  requestedUrl: string
  transport: 'public_http_v1'
  fetchedAt: string
  finalUrl?: string
  statusCode?: number
  contentType?: string
  parserVersion?: 'public-html-v1'
  body?: string
  bodyHash?: string
  text?: string
  textTruncated?: boolean
  title?: string
  errorCode?: string
}

/** Retain one public response. No scripts, models, prices or database writes run here. */
export async function acquirePublicSource(url: string): Promise<SourceReceipt> {
  const receipt: SourceReceipt = {
    status: 'uncertain', requestedUrl: url, transport: 'public_http_v1', fetchedAt: new Date().toISOString(),
  }
  try {
    const { response, finalUrl } = await safePublicFetchWithMetadata(url, { timeoutMs: 25000, maxBytes: 1_000_000, headers: { accept: 'text/html, application/xhtml+xml, text/plain' } })
    receipt.fetchedAt = new Date().toISOString()
    receipt.finalUrl = finalUrl
    receipt.statusCode = response.status
    receipt.contentType = (response.headers.get('content-type') || '').slice(0, 200)
    if (!response.ok) return { ...receipt, status: 'failed', errorCode: 'http_error' }
    const type = receipt.contentType.split(';')[0].trim().toLowerCase()
    if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(type)) return { ...receipt, status: 'failed', errorCode: 'unsupported_content' }
    const charset = receipt.contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]?.toLowerCase()
    if (charset && !['utf-8', 'utf8', 'us-ascii'].includes(charset)) return { ...receipt, status: 'failed', errorCode: 'unsupported_encoding' }
    let body: string
    try { body = new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer()) }
    catch { return { ...receipt, status: 'failed', errorCode: 'unsupported_encoding' } }
    if (Array.from(body).some(character => { const code = character.charCodeAt(0); return code < 32 && ![9, 10, 13].includes(code) })) return { ...receipt, status: 'failed', errorCode: 'unsupported_encoding' }
    receipt.body = body
    receipt.bodyHash = createHash('sha256').update(body, 'utf8').digest('hex')
    receipt.parserVersion = 'public-html-v1'
    let sourceText = body
    if (type !== 'text/plain') {
      const $ = load(body)
      receipt.title = $('title').first().text().trim().slice(0, 500)
      $('script,style,noscript,template,svg,iframe,[hidden],[aria-hidden="true"]').remove()
      // Separate block and table cells, preserving quoted values and text order.
      $('br,hr').replaceWith('\n')
      $('p,div,section,article,li,td,th,h1,h2,h3,h4,h5,h6').append('\n')
      sourceText = $('body').text()
    }
    const normalized = sourceText.replace(/\u00a0/g, ' ').replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    receipt.textTruncated = normalized.length > 50000
    receipt.text = normalized.slice(0, 50000).trim()
    if (receipt.text.length < 50) return { ...receipt, status: 'failed', errorCode: 'insufficient_text' }
    // A page that only asks a visitor to pass a bot challenge is not pricing evidence.
    if (/^(just a moment|attention required|access denied|verify (?:that )?you are human)/i.test(receipt.title || '') ||
        (receipt.text.length < 1500 && /verify (?:that )?you are human|checking your browser|enable javascript and cookies to continue/i.test(receipt.text))) {
      return { ...receipt, status: 'failed', errorCode: 'challenge_page' }
    }
    return { ...receipt, status: 'received' }
  } catch (error) {
    return { ...receipt, status: error instanceof UnsafePublicUrl ? 'failed' : 'uncertain', errorCode: error instanceof UnsafePublicUrl ? 'unsafe_source' : 'fetch_unconfirmed' }
  }
}
