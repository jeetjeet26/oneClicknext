/**
 * SSRF-safe media URL validation and fetching for ForgeStudio.
 *
 * Media URLs flow from operator input into provider publish calls (and, for
 * providers that require binary upload, into server-side fetches). Every URL
 * must be a public https URL; localhost, private ranges, and non-http(s)
 * schemes are rejected before any request is made.
 */

import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

const MAX_MEDIA_BYTES = 100 * 1024 * 1024 // 100 MB guardrail for video uploads
const FETCH_TIMEOUT_MS = 60_000

export class UnsafeMediaUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeMediaUrlError'
  }
}

function isPrivateIPv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true
  const [a, b] = octets
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true // link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return false
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase()
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fe80') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('::ffff:') // v4-mapped; resolved separately below
  )
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isPrivateIPv4(address)
  if (version === 6) {
    if (address.toLowerCase().startsWith('::ffff:')) {
      return isPrivateIPv4(address.slice(address.lastIndexOf(':') + 1))
    }
    return isPrivateIPv6(address)
  }
  return true
}

/**
 * Validate the shape of a media URL without touching the network.
 * Throws UnsafeMediaUrlError for anything that is not a public-looking https URL.
 */
export function assertSafeMediaUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UnsafeMediaUrlError(`Media URL is not a valid URL: ${rawUrl.slice(0, 120)}`)
  }

  if (url.protocol !== 'https:') {
    throw new UnsafeMediaUrlError('Media URLs must use https')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new UnsafeMediaUrlError('Media URLs must not target local hosts')
  }

  if (isIP(hostname) && isPrivateAddress(hostname)) {
    throw new UnsafeMediaUrlError('Media URLs must not target private IP ranges')
  }

  return url
}

/**
 * Resolve the hostname and reject URLs whose DNS answer points at a private
 * address, then fetch the media with a size cap and timeout.
 */
export async function fetchMediaSafely(
  rawUrl: string,
  options: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<{ data: Buffer; contentType: string | null }> {
  const url = assertSafeMediaUrl(rawUrl)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')

  if (!isIP(hostname)) {
    const resolved = await lookup(hostname, { all: true }).catch(() => [])
    if (resolved.length === 0) {
      throw new UnsafeMediaUrlError(`Could not resolve media host: ${hostname}`)
    }
    for (const entry of resolved) {
      if (isPrivateAddress(entry.address)) {
        throw new UnsafeMediaUrlError('Media URL resolves to a private address')
      }
    }
  }

  const maxBytes = options.maxBytes ?? MAX_MEDIA_BYTES
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url.toString(), {
      redirect: 'error',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Media fetch failed with HTTP ${response.status}`)
    }

    const declaredLength = Number(response.headers.get('content-length') || '0')
    if (declaredLength > maxBytes) {
      throw new UnsafeMediaUrlError('Media exceeds the maximum allowed size')
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) {
      throw new UnsafeMediaUrlError('Media exceeds the maximum allowed size')
    }

    return { data: buffer, contentType: response.headers.get('content-type') }
  } finally {
    clearTimeout(timer)
  }
}
