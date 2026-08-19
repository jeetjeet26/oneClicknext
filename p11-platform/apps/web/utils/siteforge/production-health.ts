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
}

type ProbeContext = SiteForgeHealthTarget & {
  fetch: typeof fetch
  document: () => Promise<Omit<SiteForgeFetchedDocument, 'url'>>
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
      (a === 192 && b === 168)
    )
  }
  const normalized = address.toLowerCase()
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  )
}

async function assertPublicHealthTarget(
  value: string,
  resolve: typeof lookup = lookup
) {
  const hostname = new URL(value).hostname
  if (hostname === 'localhost' || isPrivateAddress(hostname)) {
    throw new Error('Production health target cannot use a private address')
  }
  const addresses = await resolve(hostname, { all: true })
  if (!addresses.length || addresses.some(result => isPrivateAddress(result.address))) {
    throw new Error('Production health target resolved to a private address')
  }
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
  passed: true,
  state: 'not_configured',
  summary,
  evidence: { applicable: false, ...evidence },
})
const unobservable = (
  summary: string,
  evidence?: SiteForgeProbeResult['evidence']
): SiteForgeProbeResult => ({
  passed: true,
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
  return fetcher(url, {
    redirect: 'follow',
    ...init,
    signal: init.signal || AbortSignal.timeout(15_000),
  })
}

export function createDefaultSiteForgeHealthProbes(): SiteForgeHealthProbes {
  return {
    dns: async context => {
      const hostname = new URL(context.url).hostname
      const result = await lookup(hostname)
      return pass('DNS resolves', { hostname, address: result.address })
    },
    tls: async context => {
      if (new URL(context.url).protocol !== 'https:') {
        return fail('Production URL is not HTTPS', 'critical')
      }
      const response = await fetchWithTimeout(context.fetch, context.url, {
        method: 'HEAD',
      })
      return response.status < 500
        ? pass('TLS connection succeeded', { status: response.status })
        : fail('TLS endpoint returned a server error', 'critical', {
            status: response.status,
          })
    },
    reachability: async context => {
      const document = await context.document()
      return document.status >= 200 && document.status < 500
        ? pass('Production homepage is reachable', { status: document.status })
        : fail('Production homepage is unavailable', 'critical', {
            status: document.status,
          })
    },
    links: async context => {
      const documents = await context.documents()
      const broken = documents
        .filter(document => document.status < 200 || document.status >= 400)
        .map(document => ({ url: document.url, status: document.status }))
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
      const documents = await context.documents()
      const forms = documents.flatMap(document =>
        [...document.body.matchAll(/<form\b[^>]*>/gi)].map(match => ({
          url: document.url,
          markup: match[0],
        }))
      )
      if (!forms.length) return notConfigured('No production forms are configured')
      const invalid = forms.filter(form => {
        const action =
          form.markup.match(/\baction=["']([^"']+)["']/i)?.[1] ||
          form.markup.match(/\bdata-endpoint=["']([^"']+)["']/i)?.[1]
        const method = form.markup.match(/\bmethod=["']([^"']+)["']/i)?.[1] || 'get'
        return (
          !action ||
          /^(?:javascript:|mailto:|#)/i.test(action.trim()) ||
          !['get', 'post'].includes(method.toLowerCase())
        )
      })
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
      const { body } = await context.document()
      const configured = contains(body, /lumaleasing|p11[-_ ]?widget/i)
      return configured
        ? pass('Leasing widget marker is present', { applicable: true })
        : notConfigured('Leasing widget is not configured')
    },
    tours: async context => {
      const { body } = await context.document()
      const configured = contains(body, /schedule[^<]{0,20}tour|tour[-_/ ]?request/i)
      return configured
        ? pass('Tour conversion path is present', { applicable: true })
        : notConfigured('Tour path is not configured')
    },
    inventory: async context => {
      const { body } = await context.document()
      const configured = contains(
        body,
        /availability|floor[- ]?plans?|home[- ]?plans?|quick[- ]?move[- ]?in|homesites?|unit[-_ ]?inventory|home[-_ ]?inventory/i
      )
      return configured
        ? pass('Inventory or offering surface is present', { applicable: true })
        : notConfigured('Inventory is not configured')
    },
    connector_freshness: async context => {
      const connectors = context.connectors || []
      if (!connectors.length) {
        return notConfigured(
          'No production connector freshness contracts are configured'
        )
      }
      const now = Date.now()
      const stale = connectors.filter(connector => {
        if (connector.status !== 'active' && connector.status !== 'healthy') return true
        if (!connector.freshnessSeconds) return false
        const lastSuccess = connector.lastSuccessAt
          ? Date.parse(connector.lastSuccessAt)
          : Number.NaN
        return (
          !Number.isFinite(lastSuccess) ||
          now - lastSuccess > connector.freshnessSeconds * 1_000
        )
      })
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
      const documents = await context.documents()
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
      const { body } = await context.document()
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
      const { body } = await context.document()
      const privacy = /privacy/i.test(body)
      const housing = /fair housing|equal housing/i.test(body)
      return privacy && housing
        ? pass('Required legal navigation is present')
        : fail('Legal navigation is incomplete', 'high', { privacy, housing })
    },
    accessibility: async context => {
      const documents = await context.documents()
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
      const documents = await context.documents()
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
      const { body, headers } = await context.document()
      const remoteArtifactId =
        headers.get('x-siteforge-artifact-id') ||
        body.match(/data-siteforge-artifact-id=["']([^"']+)["']/i)?.[1] ||
        null
      if (!remoteArtifactId) {
        return fail('Remote artifact identity marker is unavailable', 'critical', {
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
      const { body, headers } = await context.document()
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
      const { body, headers } = await context.document()
      const raw =
        headers.get('x-siteforge-plugin-vulnerabilities') ||
        body.match(/data-siteforge-plugin-vulnerabilities=["'](\d+)["']/i)?.[1] ||
        null
      const count = raw === null ? null : Number(raw)
      return count !== null && Number.isFinite(count) && count > 0
        ? fail('Production reports vulnerable runtime plugins', 'critical', { count })
        : count === null
          ? unobservable('Plugin vulnerability contract is not exposed')
          : pass('No plugin vulnerabilities are reported', {
              applicable: true,
              count,
            })
    },
    expiring_specials: async context => {
      const documents = await context.documents()
      const expiries = documents.flatMap(document =>
        [...document.body.matchAll(/data-(?:special-)?expires-at=["']([^"']+)["']/gi)].map(
          match => ({ url: document.url, expiresAt: match[1] })
        )
      )
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
      const { body, headers } = await context.document()
      const remoteHash =
        headers.get('x-siteforge-content-hash') ||
        body.match(/data-siteforge-content-hash=["']([a-f0-9]{64})["']/i)?.[1] ||
        null
      if (!remoteHash) {
        return fail('Production content-drift evidence is unavailable', 'high', {
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
  const critical = check === 'dns' || check === 'tls' || check === 'reachability'
  return fail(
    error instanceof Error ? error.message : `${check} probe failed`,
    critical ? 'critical' : 'high'
  )
}

export async function runSiteForgeHealth(
  target: SiteForgeHealthTarget,
  options: {
    trigger: SiteForgeHealthTrigger
    probes?: Partial<SiteForgeHealthProbes>
    fetch?: typeof fetch
    resolve?: typeof lookup
  }
) {
  const service = createServiceClient()
  const url = normalizeUrl(target.url)
  await assertPublicHealthTarget(url, options.resolve)
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
    .select('id')
    .single()
  if (runError || !run) {
    throw new Error(`Failed to start SiteForge health run: ${runError?.message}`)
  }

  const fetcher = options.fetch || fetch
  let documentPromise:
    | Promise<Omit<SiteForgeFetchedDocument, 'url'>>
    | undefined
  let documentsPromise: Promise<SiteForgeFetchedDocument[]> | undefined
  const context: ProbeContext = {
    ...target,
    url,
    fetch: fetcher,
    document: () => {
      documentPromise ||= (async () => {
        const start = Date.now()
        const response = await fetchWithTimeout(fetcher, url)
        return {
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
                const candidate = new URL(candidateValue, url)
                return candidate.origin === origin &&
                  ['http:', 'https:'].includes(candidate.protocol)
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
        return [check, await probes[check](context)] as const
      } catch (error) {
        return [check, probeFailure(check, error)] as const
      }
    })
  )
  const checks = Object.fromEntries(entries) as Record<
    SiteForgeHealthCheck,
    SiteForgeProbeResult
  >
  const failed = entries.filter(([, result]) => !result.passed)
  const status =
    failed.some(([, result]) => result.severity === 'critical')
      ? 'unhealthy'
      : failed.length
        ? 'degraded'
        : 'healthy'
  const completedAt = new Date().toISOString()

  const { error: completeError } = await service
    .from('siteforge_health_runs')
    .update({
      status,
      checks: checks as unknown as Json,
      evidence: {
        url,
        failedChecks: failed.map(([check]) => check),
      } as Json,
      completed_at: completedAt,
    })
    .eq('id', run.id)
  if (completeError) {
    throw new Error(`Failed to complete SiteForge health run: ${completeError.message}`)
  }

  for (const [check, result] of entries) {
    if (result.passed) {
      if (options.trigger !== 'repair') {
        await service
          .from('siteforge_incidents')
          .update({
            status: 'resolved',
            resolved_at: completedAt,
            updated_at: completedAt,
          })
          .eq('website_id', target.websiteId)
          .eq('dedupe_key', `production-health:${check}`)
          .neq('status', 'resolved')
      }
      continue
    }
    const incidentValues = {
      org_id: target.orgId,
      property_id: target.propertyId,
      website_id: target.websiteId,
      artifact_id: target.artifactId,
      dedupe_key: `production-health:${check}`,
      severity: result.severity || 'medium',
      category: check,
      title: `Production ${check} check failed`,
      summary: result.summary,
      evidence: {
        healthRunId: run.id,
        ...(result.evidence || {}),
      } as Json,
      updated_at: completedAt,
    }
    const { data: existing } = await service
      .from('siteforge_incidents')
      .select('id')
      .eq('website_id', target.websiteId)
      .eq('dedupe_key', incidentValues.dedupe_key)
      .neq('status', 'resolved')
      .maybeSingle()
    if (existing) {
      await service.from('siteforge_incidents').update(incidentValues).eq('id', existing.id)
    } else {
      await service.from('siteforge_incidents').insert(incidentValues)
    }
  }

  const requiresSafetyRestore = failed.some(
    ([check]) =>
      check === 'identity' ||
      check === 'content_drift' ||
      check === 'reachability' ||
      check === 'runtime'
  )
  if (requiresSafetyRestore && options.trigger !== 'restore') {
    try {
      await requestSafetyRestore(target, run.id, failed.map(([check]) => check))
    } catch (error) {
      console.error('[siteforge_production_health] restore request failed', {
        websiteId: target.websiteId,
        healthRunId: run.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { runId: run.id, status, checks, requiresSafetyRestore }
}

async function requestSafetyRestore(
  target: SiteForgeHealthTarget,
  healthRunId: string,
  failedChecks: SiteForgeHealthCheck[]
) {
  const service = createServiceClient()
  const { data: release } = await service
    .from('siteforge_launch_releases')
    .select(
      'id, backup_id, rollback_artifact_id, rollback_content_hash, artifact_id, artifact_content_hash, state, approved_by, created_by'
    )
    .eq('website_id', target.websiteId)
    .in('state', ['promoted', 'production_certified', 'live'])
    .order('release_version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const actorId = recordedLaunchOperatorForHealthRestore(release)
  if (!release?.backup_id || !actorId) return
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
}
