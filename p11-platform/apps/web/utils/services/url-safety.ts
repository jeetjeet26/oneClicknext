/**
 * Shared SSRF-safe URL validation for user-supplied URLs that will be
 * stored and later fetched by the data-engine or other services.
 */

const APARTMENTS_COM_HOSTS = new Set(['apartments.com', 'www.apartments.com'])

function parseUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  try {
    return new URL(value.trim())
  } catch {
    return null
  }
}

function isPrivateOrReservedIp(host: string): boolean {
  // IPv4 literal checks
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number)
    if (octets.some((o) => o > 255)) return true
    const [a, b] = octets
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  // IPv6 literals (URL hostname wraps them in brackets already stripped by URL parser)
  if (host.includes(':')) {
    const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fe80') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd')
    )
  }
  return false
}

/**
 * True only for http(s) URLs pointing at public hostnames.
 * Rejects localhost, private/link-local/reserved IPs, bare internal
 * hostnames, and URLs with embedded credentials.
 */
export function isSafePublicHttpUrl(value: unknown): boolean {
  const url = parseUrl(value)
  if (!url) return false
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return false
  if (!host.includes('.') && !host.includes(':')) return false
  if (isPrivateOrReservedIp(host)) return false
  return true
}

/**
 * Strict hostname validation for apartments.com listing URLs.
 * Substring checks (`url.includes('apartments.com')`) are unsafe because
 * they match evil.com/apartments.com and apartments.com.evil.com.
 */
export function isApartmentsComUrl(value: unknown): boolean {
  if (!isSafePublicHttpUrl(value)) return false
  const url = parseUrl(value)
  return url !== null && APARTMENTS_COM_HOSTS.has(url.hostname.toLowerCase())
}
