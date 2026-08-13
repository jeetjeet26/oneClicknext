import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
import { unauthorized, validateCronAuth } from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'
import {
  createDefaultSiteForgeHealthProbes,
  declaredSiteForgePagePaths,
  runSiteForgeHealth,
  SITEFORGE_HEALTH_CHECKS,
  type SiteForgeHealthProbes,
} from '@/utils/siteforge/production-health'
import { throwIfSiteForgeFailpoint } from '@/utils/siteforge/failure-injection'
import { sendSiteForgeIncidentAlert } from '@/utils/siteforge/incident-alerts'
import { processSiteForgeRestoreDrills } from '@/utils/siteforge/restore-drill-runner'
import { reconcileStaleSiteForgeJobs } from '@/utils/siteforge/stale-job-reconciler'

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/siteforge-production-health')
  ctx.logStart()
  const authError = validateCronAuth(request)
  if (authError) return unauthorized(ctx.responseHeaders)

  const run = await startCronJobRun({
    jobName: 'siteforge-production-health',
    requestId: ctx.requestId,
  })
  try {
    const websiteId = new URL(request.url).searchParams.get('websiteId')
    const service = createServiceClient()
    const staleJobs = await reconcileStaleSiteForgeJobs({}, service)
    const restoreDrills = await processSiteForgeRestoreDrills({}, service)
    let query = service
      .from('property_websites')
      .select(
        'id, org_id, property_id, production_artifact_id, production_content_hash, production_url, pages_generated'
      )
      .not('production_url', 'is', null)
      .not('production_certified_at', 'is', null)
      .order('production_certified_at', { ascending: true })
      .limit(100)
    if (websiteId) query = query.eq('id', websiteId)
    const { data: websites, error } = await query
    if (error) throw new Error(`Failed to load production websites: ${error.message}`)
    const websiteIds = (websites || []).map(website => website.id)
    const { data: connectorRows, error: connectorError } = websiteIds.length
      ? await service
          .from('siteforge_connector_configs')
          .select(
            'id, website_id, capability, status, last_success_at, freshness_seconds'
          )
          .in('website_id', websiteIds)
      : { data: [], error: null }
    if (connectorError) {
      throw new Error(
        `Failed to load production connector freshness: ${connectorError.message}`
      )
    }

    const results = []
    for (const website of websites || []) {
      if (!website.production_url) continue
      try {
        const defaults = createDefaultSiteForgeHealthProbes()
        const probes = Object.fromEntries(
          SITEFORGE_HEALTH_CHECKS.map(check => [
            check,
            async (probeContext: Parameters<SiteForgeHealthProbes[typeof check]>[0]) => {
              await throwIfSiteForgeFailpoint({
                orgId: website.org_id,
                failpoint: `production-health:${check}`,
                scopeKey: website.id,
              })
              return defaults[check](probeContext)
            },
          ])
        ) as SiteForgeHealthProbes
        const result = await runSiteForgeHealth(
          {
            orgId: website.org_id,
            propertyId: website.property_id,
            websiteId: website.id,
            artifactId: website.production_artifact_id,
            contentHash: website.production_content_hash,
            url: website.production_url,
            declaredPages: declaredSiteForgePagePaths(website.pages_generated),
            connectors: (connectorRows || [])
              .filter(connector => connector.website_id === website.id)
              .map(connector => ({
                id: connector.id,
                capability: connector.capability,
                status: connector.status,
                lastSuccessAt: connector.last_success_at,
                freshnessSeconds: connector.freshness_seconds,
              })),
          },
          { trigger: 'scheduled', probes }
        )
        results.push({ websiteId: website.id, ...result })
      } catch (cause) {
        results.push({
          websiteId: website.id,
          status: 'failed',
          error: cause instanceof Error ? cause.message : 'Health run failed',
        })
      }
    }
    const failed = results.filter(result => result.status === 'failed').length
    const unhealthy = results.filter(result => result.status === 'unhealthy').length
    const operationalFailures = failed + unhealthy + restoreDrills.failed
    const summary = {
      processed: results.length,
      failed,
      unhealthy,
      degraded: results.filter(result => result.status === 'degraded').length,
      staleJobsRecovered: staleJobs.recovered,
      restoreDrills,
    }
    if (operationalFailures) {
      const failedWebsiteIds = new Set(
        results
          .filter(
            result =>
              result.status === 'failed' || result.status === 'unhealthy'
          )
          .map(result => result.websiteId)
      )
      await sendSiteForgeIncidentAlert({
        orgIds: [
          ...(websites || [])
            .filter(website => failedWebsiteIds.has(website.id))
            .map(website => website.org_id),
          ...restoreDrills.results
            .filter(result => result.status === 'failed')
            .map(result => result.orgId),
        ],
        runId: run?.id || ctx.requestId,
        summary,
      })
    }
    await finishCronJobRun(run, {
      status: operationalFailures ? 'failed' : 'success',
      error: operationalFailures
        ? 'Production health or restore verification requires operator attention'
        : null,
      summary,
    })
    ctx.logSuccess(200, summary)
    return NextResponse.json(
      {
        success: operationalFailures === 0,
        ...summary,
        staleJobs,
        results,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Production health cron failed'
    await finishCronJobRun(run, {
      status: 'failed',
      error: message,
      summary: { operation: 'siteforge-production-health' },
    })
    ctx.logError(500, cause)
    return NextResponse.json(
      { error: message },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
