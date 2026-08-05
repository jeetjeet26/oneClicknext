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
  'forms',
  'widget',
  'tours',
  'inventory',
  'indexability',
  'sitemap',
  'brand',
  'legal',
  'accessibility',
  'performance',
  'identity',
] as const

export type SiteForgeHealthCheck = (typeof SITEFORGE_HEALTH_CHECKS)[number]
export type SiteForgeHealthTrigger = 'scheduled' | 'launch' | 'manual' | 'repair' | 'restore'

export type SiteForgeProbeResult = {
  passed: boolean
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
}

type ProbeContext = SiteForgeHealthTarget & {
  fetch: typeof fetch
  document: () => Promise<{ body: string; status: number; elapsedMs: number; headers: Headers }>
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
): SiteForgeProbeResult => ({ passed: true, summary, evidence })
const fail = (
  summary: string,
  severity: NonNullable<SiteForgeProbeResult['severity']>,
  evidence?: SiteForgeProbeResult['evidence']
): SiteForgeProbeResult => ({ passed: false, summary, severity, evidence })

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
      const { body } = await context.document()
      const hrefs = [...body.matchAll(/href=["']([^"'#]+)["']/gi)]
        .map(match => match[1])
        .filter(Boolean)
        .slice(0, 20)
      const malformed = hrefs.filter(href => {
        try {
          new URL(href, context.url)
          return false
        } catch {
          return true
        }
      })
      return malformed.length === 0
        ? pass('Sampled links are syntactically valid', { sampled: hrefs.length })
        : fail('Malformed links were found', 'medium', { malformed })
    },
    forms: async context => {
      const { body } = await context.document()
      const forms = [...body.matchAll(/<form\b[^>]*>/gi)].map(match => match[0])
      if (!forms.length) return pass('No production forms are configured', { applicable: false })
      const invalid = forms.filter(form => !/\b(action|data-endpoint)=/i.test(form))
      return invalid.length === 0
        ? pass('Production forms expose submission targets', { forms: forms.length })
        : fail('A production form lacks a submission target', 'high', {
            forms: forms.length,
            invalid: invalid.length,
          })
    },
    widget: async context => {
      const { body } = await context.document()
      const configured = contains(body, /lumaleasing|p11[-_ ]?widget/i)
      return pass(
        configured ? 'Leasing widget marker is present' : 'Leasing widget is not configured',
        { applicable: configured }
      )
    },
    tours: async context => {
      const { body } = await context.document()
      const configured = contains(body, /schedule[^<]{0,20}tour|tour[-_/ ]?request/i)
      return pass(configured ? 'Tour conversion path is present' : 'Tour path is not configured', {
        applicable: configured,
      })
    },
    inventory: async context => {
      const { body } = await context.document()
      const configured = contains(body, /availability|floor[- ]?plans?|unit[-_ ]?inventory/i)
      return pass(
        configured ? 'Inventory or floor-plan surface is present' : 'Inventory is not configured',
        { applicable: configured }
      )
    },
    indexability: async context => {
      const { body } = await context.document()
      return contains(body, /<meta[^>]+(?:name=["']robots["'][^>]+content=["'][^"']*noindex|content=["'][^"']*noindex[^>]+name=["']robots["'])/i)
        ? fail('Production homepage is marked noindex', 'high')
        : pass('Production homepage is indexable')
    },
    sitemap: async context => {
      const response = await fetchWithTimeout(
        context.fetch,
        `${context.url}/sitemap.xml`
      )
      return response.ok
        ? pass('Sitemap is reachable', { status: response.status })
        : fail('Sitemap is unavailable', 'medium', { status: response.status })
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
      const { body } = await context.document()
      const hasLanguage = /<html[^>]+\blang=["'][^"']+["']/i.test(body)
      const images = [...body.matchAll(/<img\b[^>]*>/gi)].map(match => match[0])
      const missingAlt = images.filter(image => !/\balt=["'][^"']*["']/i.test(image)).length
      return hasLanguage && missingAlt === 0
        ? pass('Baseline accessibility checks pass', { images: images.length })
        : fail('Baseline accessibility checks failed', 'medium', {
            hasLanguage,
            missingAlt,
          })
    },
    performance: async context => {
      const { body, elapsedMs } = await context.document()
      const passed = elapsedMs <= 5_000 && body.length <= 5_000_000
      return passed
        ? pass('Homepage performance is within safety bounds', {
            elapsedMs,
            bytes: body.length,
          })
        : fail('Homepage exceeded performance safety bounds', 'medium', {
            elapsedMs,
            bytes: body.length,
          })
    },
    identity: async context => {
      if (!context.contentHash) {
        return pass('No promoted artifact identity is recorded', { applicable: false })
      }
      const { body, headers } = await context.document()
      const remoteHash =
        headers.get('x-siteforge-content-hash') ||
        body.match(/data-siteforge-content-hash=["']([a-f0-9]{64})["']/i)?.[1] ||
        null
      if (!remoteHash) {
        return fail('Remote artifact identity marker is unavailable', 'critical', {
          expectedHash: context.contentHash,
        })
      }
      return remoteHash === context.contentHash
        ? pass('Remote artifact identity matches production', { remoteHash })
        : fail('Remote artifact identity does not match production', 'critical', {
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
    | Promise<{ body: string; status: number; elapsedMs: number; headers: Headers }>
    | undefined
  const context: ProbeContext = {
    ...target,
    url,
    fetch: fetcher,
    document: () => {
      documentPromise ||= (async () => {
        const start = Date.now()
        const response = await fetchWithTimeout(fetcher, url)
        return {
          body: await response.text(),
          status: response.status,
          elapsedMs: Date.now() - start,
          headers: response.headers,
        }
      })()
      return documentPromise
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
      await service
        .from('siteforge_incidents')
        .update({ status: 'resolved', resolved_at: completedAt, updated_at: completedAt })
        .eq('website_id', target.websiteId)
        .eq('dedupe_key', `production-health:${check}`)
        .neq('status', 'resolved')
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
    ([check]) => check === 'identity' || check === 'reachability'
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
  const actorId = release?.approved_by || release?.created_by
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
