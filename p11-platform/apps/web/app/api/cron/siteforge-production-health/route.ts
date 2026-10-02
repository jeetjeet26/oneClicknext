import { isDeliveryPaused } from '@/utils/services/delivery-guard'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { confirmCronJobRun, finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
import { unauthorized, validateCronAuth } from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'
import { deliverPendingHealthAlerts } from '@/utils/siteforge/health-alerts'
import { monitoringPurpose, type MonitoringPurpose } from '@/utils/siteforge/health-state'
import { visitMonitoringSweep } from '@/utils/siteforge/monitoring-sweep'
import { recordOperationalIncident } from '@/utils/siteforge/operational-incidents'
import { createDefaultSiteForgeHealthProbes, declaredSiteForgePagePaths, runSiteForgeHealth,
  SITEFORGE_HEALTH_CHECKS, type SiteForgeHealthProbes } from '@/utils/siteforge/production-health'
import { throwIfSiteForgeFailpoint } from '@/utils/siteforge/failure-injection'
import { processSiteForgeRestoreDrills } from '@/utils/siteforge/restore-drill-runner'
import { reconcileStaleSiteForgeJobs } from '@/utils/siteforge/stale-job-reconciler'

export const maxDuration = 300
type Result = { websiteId: string; orgId: string; purpose: MonitoringPurpose; status: string
  counts?: { unobservable: number }; alertIncidentIds?: string[]; error?: string }

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/siteforge-production-health')
  ctx.logStart()
  if (validateCronAuth(request)) return unauthorized(ctx.responseHeaders)
  const websiteId = new URL(request.url).searchParams.get('websiteId')
  if (websiteId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(websiteId))
    return NextResponse.json({ error: 'Invalid website identifier' }, { status: 400, headers: ctx.responseHeaders })
  const run = await startCronJobRun({ jobName: 'siteforge-production-health', requestId: ctx.requestId })
  if (!run) return NextResponse.json({ error: 'Monitoring could not save its run record; no work started' }, { status: 503, headers: ctx.responseHeaders })
  const results: Result[] = []
  const alerts = { accepted: 0, held: 0, skipped: 0, paused: isDeliveryPaused() }
  let staleJobs: Awaited<ReturnType<typeof reconcileStaleSiteForgeJobs>> | null = null
  let restoreDrills: Awaited<ReturnType<typeof processSiteForgeRestoreDrills>> = { processed: 0, succeeded: 0, failed: 0, awaitingOperator: 0, results: [] }
  try {
    const service = createServiceClient()
    let initialized = false
    const coverage = await visitMonitoringSweep({ token: run.id, websiteId, deadline: Date.now() + 210_000,
      visit: async websites => {
        // Manual checks never replay the global recovery queue. Scheduled work is lease-protected.
        if (!initialized && !websiteId) {
          initialized = true
          staleJobs = await reconcileStaleSiteForgeJobs({}, service)
          restoreDrills = await processSiteForgeRestoreDrills({}, service)
          for (const drill of restoreDrills.results) {
            if (drill.status === 'awaiting_operator') continue
            const incidentId = await recordOperationalIncident({ websiteId: drill.websiteId, orgId: drill.orgId,
              propertyId: drill.propertyId, operation: 'restore', failed: drill.status === 'failed',
              observedAt: drill.observedAt, summary: drill.error || 'Restoration verified', evidence: { drillId: drill.drillId } }, service)
            if (incidentId) {
              const delivered = await deliverPendingHealthAlerts({ incidentIds: [incidentId], summary: {
                processed: 0, failed: 0, unhealthy: 0, degraded: 0, staleJobsRecovered: null,
                restoreDrills: { failed: 1, awaitingOperator: 0 },
              } }, service)
              alerts.accepted += delivered.accepted; alerts.held += delivered.held; alerts.skipped += delivered.skipped; alerts.paused ||= delivered.paused
            }
          }
        }
        const ids = websites.map(website => website.id)
        const targetIds = websites.flatMap(website => website.production_target_id ? [website.production_target_id] : [])
        const [connectors, targets] = await Promise.all([
          ids.length ? service.from('siteforge_connector_configs').select('id,website_id,capability,status,last_success_at,freshness_seconds').in('website_id', ids) : { data: [], error: null },
          targetIds.length ? service.from('siteforge_wordpress_targets').select('id,website_id,target_type,is_active,site_url,metadata').in('id', targetIds) : { data: [], error: null },
        ])
        if (connectors.error || targets.error) throw new Error(`Monitoring context is unavailable: ${connectors.error?.message || targets.error?.message}`)
        for (let offset = 0; offset < websites.length; offset += 4) {
          const settled = await Promise.allSettled(websites.slice(offset, offset + 4).map(async website => {
            if (!website.production_url) return
            const purpose = monitoringPurpose((targets.data || []).find(target => target.id === website.production_target_id && target.website_id === website.id) || null, website.production_url)
            let outcome: Result
            try {
              const defaults = createDefaultSiteForgeHealthProbes()
              const probes = Object.fromEntries(SITEFORGE_HEALTH_CHECKS.map(check => [check,
                async (probeContext: Parameters<SiteForgeHealthProbes[typeof check]>[0]) => {
                  await throwIfSiteForgeFailpoint({ orgId: website.org_id, failpoint: `production-health:${check}`, scopeKey: website.id })
                  return defaults[check](probeContext)
                }])) as SiteForgeHealthProbes
              const result = await runSiteForgeHealth({ orgId: website.org_id, propertyId: website.property_id,
                websiteId: website.id, artifactId: website.production_artifact_id, contentHash: website.production_content_hash,
                url: website.production_url, purpose, declaredPages: declaredSiteForgePagePaths(website.pages_generated),
                connectors: (connectors.data || []).filter(connector => connector.website_id === website.id).map(connector => ({
                  id: connector.id, capability: connector.capability, status: connector.status,
                  lastSuccessAt: connector.last_success_at, freshnessSeconds: connector.freshness_seconds,
                })),
              }, { trigger: 'scheduled', probes, service })
              outcome = { websiteId: website.id, orgId: website.org_id, ...result, purpose }
            } catch (cause) {
              const pending = cause && typeof cause === 'object' && 'alertIncidentIds' in cause && Array.isArray(cause.alertIncidentIds) ? cause.alertIncidentIds.filter((id): id is string => typeof id === 'string') : []
              outcome = { websiteId: website.id, orgId: website.org_id, purpose, status: 'failed',
                error: cause instanceof Error ? cause.message : 'Monitoring failed', alertIncidentIds: pending }
            }
            results.push(outcome)
            // Every notification contains only the affected website's counts.
            const delivered = await deliverPendingHealthAlerts({ incidentIds: outcome.alertIncidentIds || [], summary: {
              processed: 1, failed: Number(outcome.status === 'failed'), unhealthy: Number(outcome.status === 'unhealthy'),
              degraded: Number(outcome.status === 'degraded'), staleJobsRecovered: null, restoreDrills: { failed: 0, awaitingOperator: 0 },
            } }, service)
            alerts.accepted += delivered.accepted; alerts.held += delivered.held; alerts.skipped += delivered.skipped; alerts.paused ||= delivered.paused
          }))
          const rejected = settled.find(result => result.status === 'rejected')
          if (rejected?.status === 'rejected') throw rejected.reason
        }
      },
    }, service)
    const failed = results.filter(result => result.status === 'failed').length
    const unhealthy = results.filter(result => result.status === 'unhealthy').length
    const degraded = results.filter(result => result.status === 'degraded').length
    const operationalFailures = failed + unhealthy + restoreDrills.failed
    const summary = { processed: results.length, failed, unhealthy, degraded,
      unavailableChecks: results.reduce((sum, result) => sum + (result.counts?.unobservable || 0), 0),
      targetPurposes: results.map(result => ({ websiteId: result.websiteId, purpose: result.purpose })),
      restoreDrills, alerts, coverage, staleJobsRecovered: (staleJobs as Awaited<ReturnType<typeof reconcileStaleSiteForgeJobs>> | null)?.recovered || 0 }
    const incomplete = degraded > 0 || !coverage.coverageComplete || alerts.held > 0
    await confirmCronJobRun(run, { status: operationalFailures ? 'failed' : incomplete ? 'partial' : 'success',
      error: operationalFailures ? 'Monitoring or restoration requires attention' : null, summary })
    return NextResponse.json({ success: operationalFailures === 0 && !incomplete, ...summary, staleJobs, results }, { headers: ctx.responseHeaders })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Production health cron failed'
    await finishCronJobRun(run, { status: 'failed', error: message,
      summary: { operation: 'siteforge-production-health', processed: results.length, alerts } })
    ctx.logError(500, cause)
    return NextResponse.json({ error: message, processed: results.length }, { status: 500, headers: ctx.responseHeaders })
  }
}
