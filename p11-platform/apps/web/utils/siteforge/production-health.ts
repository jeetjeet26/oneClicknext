import { healthEvidenceState, isVerifiedHealthCheck, summarizeHealthChecks, type MonitoringPurpose } from './health-state'
import { recordOperationalIncident } from './operational-incidents'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { requestLaunchRestore } from '@/utils/siteforge/launch/service'

export const SITEFORGE_HEALTH_CHECKS = [
  'dns',
  'tls',
  'reachability',
  'links',
  'redirects',
  'forms',
  'widget',
  'tours',
  'inventory',
  'connector_freshness',
  'indexability',
  'sitemap',
  'brand',
  'legal',
  'accessibility',
  'performance',
  'identity',
  'runtime',
  'plugin_vulnerabilities',
  'expiring_specials',
  'content_drift',
] as const

export type SiteForgeHealthCheck = (typeof SITEFORGE_HEALTH_CHECKS)[number]
export type SiteForgeHealthTrigger = 'scheduled' | 'launch' | 'manual' | 'repair' | 'restore'

export type SiteForgeProbeResult = {
  passed: boolean
  state?: 'healthy' | 'failed' | 'not_configured' | 'unobservable'
  summary: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
  evidence?: Record<string, Json | undefined>
}

export type SiteForgeHealthTarget = {
  orgId: string
  propertyId: string
  websiteId: string
  artifactId: string | null
  contentHash: string | null
  url: string
  purpose?: MonitoringPurpose
  declaredPages?: string[]
  connectors?: Array<{
    id: string
    capability: string
    status: string
    lastSuccessAt: string | null
    freshnessSeconds: number | null
  }>
}

export function recordedLaunchOperatorForHealthRestore(release: {
  created_by: string | null
  approved_by: string | null
} | null): string | null {
  if (
    !release?.created_by ||
    !release.approved_by ||
    release.created_by === release.approved_by
  ) {
    return null
  }
  return release.created_by
}

type SiteForgeFetchedDocument = {
  url: string
  requestedUrl?: string
  redirected?: boolean
  body: string
  status: number
  elapsedMs: number
  headers: Headers
  error?: string
}

type ProbeContext = SiteForgeHealthTarget & {
  fetch: typeof fetch
  document: () => Promise<Omit<SiteForgeFetchedDocument, 'url'> & { url?: string }>
  documents: () => Promise<SiteForgeFetchedDocument[]>
}

export type SiteForgeHealthProbe = (
  context: ProbeContext
) => Promise<SiteForgeProbeResult>

export type SiteForgeHealthProbes = Record<
  SiteForgeHealthCheck,
  SiteForgeHealthProbe
>

const normalizeUrl = (value: string) => {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Production health target must use HTTP or HTTPS')
  }
  return url.toString().replace(/\/$/, '')
}

function isPrivateAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    )
  }
  if (isIP(address) !== 6) return false
  const normalized = address.toLowerCase()
  return (
    normalized.startsWith('::ffff:') || normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  )
}

export async function resolveHealthHost(hostname: string, resolve: typeof lookup = lookup) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      resolve(hostname, { all: true }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('DNS lookup exceeded 15 seconds')), 15_000) }),
    ])
  } finally { if (timeout) clearTimeout(timeout) }
}

async function assertPublicHealthTarget(
  value: string,
  resolve: typeof lookup = lookup
) {
  const parsed = new URL(value)
  if (parsed.username || parsed.password) throw new Error('Health URLs cannot contain credentials')
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateAddress(hostname)) {
    throw new Error('Production health target cannot use a private address')
  }
  const addresses = await resolveHealthHost(hostname, resolve)
  if (!addresses.length || addresses.some(result => isPrivateAddress(result.address))) {
    throw new Error('Production health target resolved to a private address')
  }
}

class UnavailableHealthEvidence extends Error {}

export function isHtmlHealthDocument(document: { headers: Headers; body: string }): boolean {
  const type = document.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (type) return type === 'text/html' || type === 'application/xhtml+xml'
  // Some older targets omit a content type; never guess HTML from an XML feed.
  return /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(document.body)
}

async function htmlDocuments(context: ProbeContext) {
  const documents = await context.documents()
  const eligible = documents.filter(doc => !doc.error && doc.status >= 200 && doc.status < 300 && isHtmlHealthDocument(doc))
  if (!eligible.length) throw new UnavailableHealthEvidence('No successful HTML page response is available for this check')
  return eligible
}
async function htmlDocument(context: ProbeContext) {
  const document = await context.document()
  if (document.status < 200 || document.status >= 300 || !isHtmlHealthDocument(document))
    throw new UnavailableHealthEvidence('The homepage did not provide a successful HTML response')
  return document
}

const contains = (body: string, pattern: RegExp) => pattern.test(body)
const pass = (
  summary: string,
  evidence?: SiteForgeProbeResult['evidence']
): SiteForgeProbeResult => ({
  passed: true,
  state: 'healthy',
  summary,
  evidence,
})
const notConfigured = (
  summary: string,
  evidence?: SiteForgeProbeResult['evidence']
): SiteForgeProbeResult => ({
  passed: false,
  state: 'not_configured',
  summary,
  evidence: { applicable: false, ...evidence },
})
const unobservable = (
  summary: string,
  evidence?: SiteForgeProbeResult['evidence']
): SiteForgeProbeResult => ({
  passed: false,
  state: 'unobservable',
  summary,
  evidence: { applicable: false, ...evidence },
})
const fail = (
  summary: string,
  severity: NonNullable<SiteForgeProbeResult['severity']>,
  evidence?: SiteForgeProbeResult['evidence']
): SiteForgeProbeResult => ({
  passed: false,
  state: 'failed',
  summary,
  severity,
  evidence,
})

export function declaredSiteForgePagePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.flatMap(page => {
        if (!page || typeof page !== 'object' || Array.isArray(page)) return []
        const record = page as Record<string, unknown>
        const raw =
          typeof record.slug === 'string'
            ? record.slug
            : typeof record.path === 'string'
              ? record.path
              : null
        if (!raw) return []
        const path = raw.trim()
        if (!path || path === '/' || path.startsWith('//') || /^https?:/i.test(path)) {
          return []
        }
        return [`/${path.replace(/^\/+|\/+$/g, '')}/`]
      })
    ),
  ].sort()
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {}
) {
  const origin = new URL(url).origin
  const signal = init.signal || AbortSignal.timeout(15_000)
  let current = url
  for (let hop = 0; hop < 6; hop++) {
    const response = await fetcher(current, { ...init, redirect: 'manual', signal })
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      // Preserve the final URL for injected fetchers as well as native fetch.
      if (!response.url) Object.defineProperty(response, 'url', { value: current })
      return response
    }
    const location = response.headers.get('location')
    if (!location) return response
    const next = new URL(location, current)
    if (next.origin !== origin || next.username || next.password) {
      await response.body?.cancel()
      throw new UnavailableHealthEvidence('Redirect leaves the checked origin; destination was not fetched')
    }
    await response.body?.cancel()
    current = next.href
  }
  throw new UnavailableHealthEvidence('Redirect limit exceeded')
}

export function createDefaultSiteForgeHealthProbes(): SiteForgeHealthProbes {
  return {
    dns: async context => {
      const hostname = new URL(context.url).hostname
      const results = await resolveHealthHost(hostname)
      if (!results.length) throw new Error('DNS returned no address')
      return pass('DNS resolves', { hostname, address: results[0].address })
    },
    tls: async context => {
      if (new URL(context.url).protocol !== 'https:') {
        return fail('Production URL is not HTTPS', 'critical')
      }
      const response = await fetchWithTimeout(context.fetch, context.url, {
        method: 'HEAD',
      })
      return pass('TLS connection succeeded', { status: response.status })
    },
    reachability: async context => {
      const document = await context.document()
      return document.status >= 200 && document.status < 300
        ? pass('Production homepage is reachable', { status: document.status })
        : fail('Production homepage is unavailable', 'critical', {
            status: document.status,
          })
    },
    links: async context => {
      const documents = await context.documents()
      const unavailable = documents.filter(document => document.error)
      const broken = documents
        .filter(document => !document.error && (document.status < 200 || document.status >= 400))
        .map(document => ({ url: document.url, status: document.status }))
      if (!broken.length && unavailable.length) return unobservable('Some linked responses could not be observed', { unavailable: unavailable.map(doc => doc.url) })
      return broken.length === 0
        ? pass('Declared and sampled internal pages are reachable', {
            sampled: documents.length,
            declared: context.declaredPages?.length || 0,
          })
        : fail('Broken declared or internal pages were found', 'high', {
            broken,
            declared: context.declaredPages || [],
          })
    },
    redirects: async context => {
      const documents = await context.documents()
      if (documents.some(doc => doc.error)) return unobservable('Redirect coverage is incomplete because some responses are unavailable')
      const redirects = documents
        .filter(document => document.redirected)
        .map(document => ({
          from: document.requestedUrl || document.url,
          to: document.url,
          status: document.status,
        }))
      const unsafe = redirects.filter(redirect => {
        try {
          return new URL(redirect.from).origin !== new URL(redirect.to).origin
        } catch {
          return true
        }
      })
      return unsafe.length
        ? fail('A declared-page journey redirected outside production', 'high', {
            redirects,
            unsafe,
          })
        : pass('Declared-page redirects remain on the production origin', {
            checked: documents.length,
            redirects,
          })
    },
    forms: async context => {
      const documents = await htmlDocuments(context)
      const forms = documents.flatMap(document =>
        [...document.body.matchAll(/<form\b[^>]*>/gi)].map(match => ({
          url: document.url,
          markup: match[0],
        }))
      )
      if (!forms.length) return unobservable('No form was observed in sampled HTML; configuration and delivery are not verified')
      const unobserved = forms.filter(form => !/\b(?:action|data-endpoint)=["'][^"']+["']/i.test(form.markup))
      const invalid = forms.filter(form => {
        const action =
          form.markup.match(/\baction=["']([^"']+)["']/i)?.[1] ||
          form.markup.match(/\bdata-endpoint=["']([^"']+)["']/i)?.[1]
        const method = form.markup.match(/\bmethod=["']([^"']+)["']/i)?.[1] || 'get'
        return (
          (Boolean(action) && /^(?:javascript:|data:|mailto:|#)/i.test(action!.trim())) ||
          !['get', 'post'].includes(method.toLowerCase())
        )
      })
      if (!invalid.length && unobserved.length) return unobservable('Form delivery requires rendered or destination evidence; no submission was attempted', { forms: forms.length, submissionsAttempted: 0 })
      return invalid.length === 0
        ? pass('Production forms expose safe declarative submission targets', {
            forms: forms.length,
            submissionsAttempted: 0,
          })
        : fail('A production form lacks a safe submission target', 'high', {
            forms: forms.length,
            invalid: invalid.length,
            submissionsAttempted: 0,
          })
    },
    widget: async context => {
      const { body } = await htmlDocument(context)
      const configured = contains(body, /lumaleasing|p11[-_ ]?widget/i)
      return configured
        ? pass('Leasing widget marker is present', { applicable: true })
        : unobservable('No leasing widget marker was observed; configuration is not verified')
    },
    tours: async context => {
      const { body } = await htmlDocument(context)
      const configured = contains(body, /schedule[^<]{0,20}tour|tour[-_/ ]?request/i)
      return configured
        ? pass('Tour conversion path is present', { applicable: true })
        : unobservable('No tour marker was observed; the conversion journey is not verified')
    },
    inventory: async context => {
      const { body } = await htmlDocument(context)
      const configured = contains(
        body,
        /availability|floor[- ]?plans?|home[- ]?plans?|quick[- ]?move[- ]?in|homesites?|unit[-_ ]?inventory|home[-_ ]?inventory/i
      )
      return configured
        ? pass('Inventory or offering surface is present', { applicable: true })
        : unobservable('No inventory marker was observed; inventory configuration is not verified')
    },
    connector_freshness: async context => {
      if (!context.connectors) return unobservable('Connector configuration was not loaded')
      const connectors = context.connectors
      if (!connectors.length) {
        return notConfigured(
          'No production connector freshness contracts are configured'
        )
      }
      const now = Date.now()
      const stale = connectors.filter(connector => {
        if (connector.status !== 'active' && connector.status !== 'healthy') return true
        if (!connector.freshnessSeconds || connector.freshnessSeconds < 0) return false
        const lastSuccess = connector.lastSuccessAt
          ? Date.parse(connector.lastSuccessAt)
          : Number.NaN
        return (
          Number.isFinite(lastSuccess) &&
          now - lastSuccess > connector.freshnessSeconds * 1_000
        )
      })
      const unavailable = connectors.filter(connector => !connector.freshnessSeconds || connector.freshnessSeconds < 0 ||
        !connector.lastSuccessAt || !Number.isFinite(Date.parse(connector.lastSuccessAt)) || Date.parse(connector.lastSuccessAt) > now)
      if (!stale.length && unavailable.length) return unobservable('Connector freshness evidence or its review interval is unavailable', { unavailable: unavailable.map(connector => connector.id) })
      return stale.length
        ? fail('One or more production connectors are stale', 'high', {
            stale,
            connectors: connectors.length,
          })
        : pass('Production connector freshness contracts are satisfied', {
            connectors: connectors.length,
          })
    },
    indexability: async context => {
      if (context.purpose && context.purpose !== 'production') return context.purpose === 'unknown'
        ? unobservable('Target purpose is unknown; production indexing requirements are not established')
        : notConfigured('Public indexing is not required for this ' + context.purpose + ' target')
      const documents = await htmlDocuments(context)
      const blocked = documents
        .filter(
          document =>
            /\bnoindex\b/i.test(document.headers.get('x-robots-tag') || '') ||
            contains(
              document.body,
              /<meta[^>]+(?:name=["']robots["'][^>]+content=["'][^"']*noindex|content=["'][^"']*noindex[^>]+name=["']robots["'])/i
            )
        )
        .map(document => document.url)
      return blocked.length
        ? fail('Production pages are marked noindex', 'high', { blocked })
        : pass('Sampled production pages are indexable', {
            sampled: documents.length,
          })
    },
    sitemap: async context => {
      if (context.purpose && context.purpose !== 'production') return context.purpose === 'unknown'
        ? unobservable('Target purpose is unknown; public sitemap requirements are not established')
        : notConfigured('A public sitemap is not required for this ' + context.purpose + ' target')
      const sitemapUrl = `${context.url}/wp-sitemap.xml`
      const response = await fetchWithTimeout(
        context.fetch,
        sitemapUrl
      )
      const body = await response.text()
      const robotsUrl = `${context.url}/robots.txt`
      const robots = await fetchWithTimeout(context.fetch, robotsUrl)
      const robotsBody = await robots.text()
      const validXml = /<(?:urlset|sitemapindex)\b/i.test(body)
      const sitemapReferenced = [...robotsBody.matchAll(/^sitemap:\s*(\S+)/gim)]
        .map(match => normalizeUrl(match[1]))
        .includes(normalizeUrl(response.url || sitemapUrl))
      return response.ok && robots.ok && validXml && sitemapReferenced
        ? pass('Sitemap and robots declarations are aligned', {
            sitemapStatus: response.status,
            robotsStatus: robots.status,
          })
        : fail('Sitemap and robots declarations are unavailable or misaligned', 'high', {
            sitemapStatus: response.status,
            robotsStatus: robots.status,
            validXml,
            sitemapReferenced,
          })
    },
    brand: async context => {
      const { body } = await htmlDocument(context)
      const hasTitle = /<title>[^<]+<\/title>/i.test(body)
      const hasIdentity = /logo|site-title|brand/i.test(body)
      return hasTitle && hasIdentity
        ? pass('Brand identity markers are present')
        : fail('Brand identity markers are incomplete', 'medium', {
            hasTitle,
            hasIdentity,
          })
    },
    legal: async context => {
      const { body } = await htmlDocument(context)
      const privacy = /privacy/i.test(body)
      const housing = /fair housing|equal housing/i.test(body)
      return privacy && housing
        ? pass('Required legal navigation is present')
        : fail('Legal navigation is incomplete', 'high', { privacy, housing })
    },
    accessibility: async context => {
      const documents = await htmlDocuments(context)
      const failures = documents.flatMap(document => {
        const hasLanguage = /<html[^>]+\blang=["'][^"']+["']/i.test(
          document.body
        )
        const images = [...document.body.matchAll(/<img\b[^>]*>/gi)].map(
          match => match[0]
        )
        const missingAlt = images.filter(
          image => !/\balt=["'][^"']*["']/i.test(image)
        ).length
        return hasLanguage && missingAlt === 0
          ? []
          : [{ url: document.url, hasLanguage, missingAlt }]
      })
      return failures.length === 0
        ? pass('Baseline accessibility checks pass across sampled pages', {
            pages: documents.length,
          })
        : fail('Baseline accessibility checks failed', 'medium', {
            failures,
          })
    },
    performance: async context => {
      const documents = await htmlDocuments(context)
      const failures = documents
        .filter(document => document.elapsedMs > 5_000 || document.body.length > 5_000_000)
        .map(document => ({
          url: document.url,
          elapsedMs: document.elapsedMs,
          bytes: document.body.length,
        }))
      return failures.length === 0
        ? pass('Declared-page performance is within safety bounds', {
            pages: documents.length,
            worstElapsedMs: Math.max(0, ...documents.map(document => document.elapsedMs)),
          })
        : fail('A declared page exceeded performance safety bounds', 'medium', {
            failures,
          })
    },
    identity: async context => {
      if (!context.artifactId) {
        return unobservable('No promoted artifact identifier is recorded')
      }
      const { body, headers } = await htmlDocument(context)
      const remoteArtifactId =
        headers.get('x-siteforge-artifact-id') ||
        body.match(/data-siteforge-artifact-id=["']([^"']+)["']/i)?.[1] ||
        null
      if (!remoteArtifactId) {
        return unobservable('Remote artifact identity marker is unavailable', {
          expectedArtifactId: context.artifactId,
        })
      }
      return remoteArtifactId === context.artifactId
        ? pass('Remote artifact identity matches production', { remoteArtifactId })
        : fail('Remote artifact identity does not match production', 'critical', {
            expectedArtifactId: context.artifactId,
            remoteArtifactId,
          })
    },
    runtime: async context => {
      const { body, headers } = await htmlDocument(context)
      const runtimeStatus =
        headers.get('x-siteforge-runtime-status') ||
        body.match(/data-siteforge-runtime-status=["']([^"']+)["']/i)?.[1] ||
        null
      return runtimeStatus && !['healthy', 'ready', 'ok'].includes(runtimeStatus.toLowerCase())
        ? fail('Production runtime reports a degraded state', 'critical', {
            runtimeStatus,
          })
        : runtimeStatus
          ? pass('Production runtime reports healthy', {
              applicable: true,
              runtimeStatus,
            })
          : unobservable('Runtime health contract is not exposed')
    },
    plugin_vulnerabilities: async context => {
      const { body, headers } = await htmlDocument(context)
      const raw =
        headers.get('x-siteforge-plugin-vulnerabilities') ||
        body.match(/data-siteforge-plugin-vulnerabilities=["']([^"']*)["']/i)?.[1] ||
        null
      const count = raw === null || !/^\d+$/.test(raw.trim()) ? null : Number(raw)
      return count !== null && Number.isFinite(count) && count > 0
        ? fail('Production reports vulnerable runtime plugins', 'critical', { count })
        : count === null || !Number.isInteger(count) || count < 0
          ? unobservable('A valid plugin vulnerability count is not exposed')
          : pass('No plugin vulnerabilities are reported', {
              applicable: true,
              count,
            })
    },
    expiring_specials: async context => {
      const documents = await htmlDocuments(context)
      const expiries = documents.flatMap(document =>
        [...document.body.matchAll(/data-(?:special-)?expires-at=["']([^"']+)["']/gi)].map(
          match => ({ url: document.url, expiresAt: match[1] })
        )
      )
      if (!expiries.length) return unobservable('No dated special was observed; special configuration is not verified')
      if (expiries.some(item => !Number.isFinite(Date.parse(item.expiresAt)))) return unobservable('A special has an invalid expiry date')
      const expired = expiries.filter(item => {
        const value = Date.parse(item.expiresAt)
        return Number.isFinite(value) && value <= Date.now()
      })
      return expired.length
        ? fail('Expired specials remain visible in production', 'medium', { expired })
        : pass('No expired specials were detected', {
            applicable: expiries.length > 0,
            expiries,
          })
    },
    content_drift: async context => {
      if (!context.contentHash) {
        return unobservable('No promoted content hash is recorded')
      }
      const { body, headers } = await htmlDocument(context)
      const remoteHash =
        headers.get('x-siteforge-content-hash') ||
        body.match(/data-siteforge-content-hash=["']([a-f0-9]{64})["']/i)?.[1] ||
        null
      if (!remoteHash) {
        return unobservable('Production content-drift evidence is unavailable', {
          expectedHash: context.contentHash,
        })
      }
      return remoteHash === context.contentHash
        ? pass('Production content hash matches the promoted artifact', { remoteHash })
        : fail('Production content drift was detected', 'critical', {
            expectedHash: context.contentHash,
            remoteHash,
          })
    },
  }
}

function probeFailure(check: SiteForgeHealthCheck, error: unknown): SiteForgeProbeResult {
  if (error instanceof UnavailableHealthEvidence) return unobservable(error.message)
  const critical = check === 'dns' || check === 'tls' || check === 'reachability'
  return critical
    ? fail(error instanceof Error ? error.message : `${check} probe failed`, 'critical')
    : unobservable(error instanceof Error ? error.message : `${check} probe could not run`)
}

export async function runSiteForgeHealth(
  target: SiteForgeHealthTarget,
  options: {
    trigger: SiteForgeHealthTrigger
    probes?: Partial<SiteForgeHealthProbes>
    fetch?: typeof fetch
    resolve?: typeof lookup
    service?: ReturnType<typeof createServiceClient>
  }
) {
  const service = options.service || createServiceClient()
  const url = normalizeUrl(target.url)
  const { data: run, error: runError } = await service
    .from('siteforge_health_runs')
    .insert({
      org_id: target.orgId,
      property_id: target.propertyId,
      website_id: target.websiteId,
      artifact_id: target.artifactId,
      status: 'running',
      trigger_type: options.trigger,
    })
    .select('id,started_at')
    .single()
  if (runError || !run) {
    throw new Error(`Failed to start SiteForge health run: ${runError?.message}`)
  }

  try {
  await assertPublicHealthTarget(url, options.resolve)
  const fetcher = options.fetch || fetch
  let documentPromise:
    | Promise<SiteForgeFetchedDocument>
    | undefined
  let documentsPromise: Promise<SiteForgeFetchedDocument[]> | undefined
  const context: ProbeContext = {
    ...target,
    purpose: target.purpose || 'unknown',
    url,
    fetch: fetcher,
    document: () => {
      documentPromise ||= (async () => {
        const start = Date.now()
        const response = await fetchWithTimeout(fetcher, url)
        return {
          url: response.url || url,
          requestedUrl: url,
          redirected: response.redirected || normalizeUrl(response.url || url) !== url,
          body: await response.text(),
          status: response.status,
          elapsedMs: Date.now() - start,
          headers: response.headers,
        }
      })()
      return documentPromise
    },
    documents: () => {
      documentsPromise ||= (async () => {
        const homepage = await context.document()
        const origin = new URL(url).origin
        const internalUrls = [
          ...new Set(
            [
              ...(context.declaredPages || []),
              ...[...homepage.body.matchAll(/href=["']([^"'#]+)["']/gi)].map(
                match => match[1]
              ),
            ].flatMap(candidateValue => {
              try {
                const candidate = new URL(candidateValue, homepage.url || url)
                return candidate.origin === origin &&
                  ['http:', 'https:'].includes(candidate.protocol) && !candidate.username && !candidate.password
                  ? [candidate.toString()]
                  : []
              } catch {
                return []
              }
            })
          ),
        ]
          .filter(candidate => normalizeUrl(candidate) !== url)
          .slice(0, 10)
        const linked = await Promise.all(
          internalUrls.map(async candidate => {
            const startedAt = Date.now()
            try {
            const response = await fetchWithTimeout(fetcher, candidate)
            return {
              url: response.url || candidate,
              requestedUrl: candidate,
              redirected:
                response.redirected ||
                normalizeUrl(response.url || candidate) !== normalizeUrl(candidate),
              body: await response.text(),
              status: response.status,
              elapsedMs: Date.now() - startedAt,
              headers: response.headers,
            }
            } catch (error) {
              return { url: candidate, requestedUrl: candidate, body: '', status: 0, elapsedMs: Date.now() - startedAt, headers: new Headers(), error: error instanceof Error ? error.message : 'Request unavailable' }
            }
          })
        )
        return [{ url, ...homepage }, ...linked]
      })()
      return documentsPromise
    },
  }
  const probes = { ...createDefaultSiteForgeHealthProbes(), ...options.probes }
  const entries = await Promise.all(
    SITEFORGE_HEALTH_CHECKS.map(async check => {
      try {
        let result = await probes[check](context)
        if (['forms', 'indexability', 'accessibility', 'expiring_specials', 'performance'].includes(check)) {
          const docs = await context.documents()
          const unavailable = docs.filter(doc => doc.error || doc.status < 200 || doc.status >= 300).map(doc => doc.url)
          const excluded = docs.filter(doc => !doc.error && doc.status >= 200 && doc.status < 300 && !isHtmlHealthDocument(doc)).map(doc => doc.url)
          if (isVerifiedHealthCheck(result) && unavailable.length) result = unobservable('Page coverage is incomplete; a passing result is not established', { unavailable, excluded })
          else result = { ...result, evidence: { ...result.evidence, excludedNonHtml: excluded } }
        }
        return [check, result] as const
      } catch (error) {
        return [check, probeFailure(check, error)] as const
      }
    })
  )
  const checks = Object.fromEntries(entries) as Record<
    SiteForgeHealthCheck,
    SiteForgeProbeResult
  >
  const failed = entries.filter(([, result]) => healthEvidenceState(result) === 'failed')
  const unknown = entries.filter(([, result]) => healthEvidenceState(result) === 'unobservable')
  const counts = summarizeHealthChecks(checks)
  const status =
    failed.some(([, result]) => result.severity === 'critical')
      ? 'unhealthy'
      : failed.length || unknown.length || !counts.healthy
        ? 'degraded'
        : 'healthy'
  // Persist every incident transition and the observation atomically. The database
  // serializes competing completions and ignores superseded observations.
  const normalizedChecks = Object.fromEntries(entries.map(([check, result]) => [check,
    { ...result, state: healthEvidenceState(result) }]))
  const { data: committed, error: commitError } = await service.rpc('finalize_siteforge_health_run', {
    p_run_id: run.id, p_status: status, p_checks: normalizedChecks as unknown as Json,
    p_evidence: { url, failedChecks: failed.map(([check]) => check),
      unavailableChecks: unknown.map(([check]) => check), counts, purpose: context.purpose } as Json,
  })
  if (commitError || !committed || typeof committed !== 'object' || Array.isArray(committed))
    throw new Error(`Monitoring completion was not confirmed: ${commitError?.message || 'Missing completion'}`)
  const completion = committed as { incidentChanges: string[]; alertIncidentIds: string[]; superseded: boolean }
  if (!Array.isArray(completion.incidentChanges) || !Array.isArray(completion.alertIncidentIds) || typeof completion.superseded !== 'boolean')
    throw new Error('Monitoring completion returned an invalid acknowledgement')
  const { incidentChanges, alertIncidentIds, superseded } = completion
  const requiresSafetyRestore = !superseded && context.purpose === 'production' && failed.some(
    ([check]) => ['identity', 'content_drift', 'reachability', 'runtime'].includes(check)
  )
  let restoreRequest: { state: string; reason?: string } = { state: 'not_requested' }
  if (requiresSafetyRestore && options.trigger !== 'restore') {
    try {
      restoreRequest = await requestSafetyRestore(target, run.id, failed.map(([check]) => check), service)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Restore request failed'
      restoreRequest = { state: 'failed', reason }
      const incidentId = await recordOperationalIncident({ websiteId: target.websiteId, orgId: target.orgId,
        propertyId: target.propertyId, operation: 'restore', failed: true, observedAt: run.started_at,
        summary: reason, evidence: { healthRunId: run.id, step: 'request_restore' } }, service)
      if (incidentId) alertIncidentIds.push(incidentId)
    }
  }

  return { runId: run.id, status, checks, counts, purpose: context.purpose, incidentChanges, alertIncidentIds, requiresSafetyRestore, superseded, restoreRequest }
  } catch (cause) {
    const failure = await service.rpc('finalize_siteforge_health_run', {
      p_run_id: run.id, p_status: 'failed', p_checks: {},
      p_evidence: { url, purpose: target.purpose || 'unknown', error: cause instanceof Error ? cause.message : 'Monitoring failed' },
    })
    if (failure.error || !failure.data) throw new Error('Monitoring outcome is uncertain; inspect the saved run before retrying', { cause })
    const evidence = failure.data as { alertIncidentIds?: string[] }
    throw Object.assign(new Error(cause instanceof Error ? cause.message : 'Monitoring failed', { cause }),
      { healthRunId: run.id, alertIncidentIds: evidence.alertIncidentIds || [] })
  }
}

async function requestSafetyRestore(
  target: SiteForgeHealthTarget,
  healthRunId: string,
  failedChecks: SiteForgeHealthCheck[],
  service = createServiceClient(),
) {
  const { data: release, error: releaseError } = await service
    .from('siteforge_launch_releases')
    .select(
      'id, backup_id, rollback_artifact_id, rollback_content_hash, artifact_id, artifact_content_hash, state, approved_by, created_by'
    )
    .eq('website_id', target.websiteId)
    .in('state', ['promoted', 'production_certified', 'live'])
    .order('release_version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (releaseError) throw new Error(`Restore source could not be loaded: ${releaseError.message}`)
  const actorId = recordedLaunchOperatorForHealthRestore(release)
  if (!release?.backup_id || !actorId) return { state: 'unavailable', reason: 'No approved release backup and operator are recorded' }
  await requestLaunchRestore(
    {
      releaseId: release.id,
      propertyId: target.propertyId,
      rationale: `Operator restore required after production health failed: ${failedChecks.join(', ')}`,
      actorId,
      requestId: healthRunId,
      source: 'production_health',
    },
    service
  )
  return { state: 'awaiting_operator' }
}
