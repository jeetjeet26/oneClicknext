import { NextRequest, NextResponse } from 'next/server'
import { unauthorized, validateCronAuth } from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'
import { createServiceClient } from '@/utils/supabase/admin'
import { persistArtifactFunnelsAndIncidents } from '@/utils/siteforge/operations/analytics'

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/siteforge-analytics')
  ctx.logStart()
  if (validateCronAuth(request)) return unauthorized(ctx.responseHeaders)
  try {
    const end = new Date()
    end.setUTCMinutes(0, 0, 0)
    const start = new Date(end.getTime() - 60 * 60 * 1000)
    const client = createServiceClient()
    const { data: websites, error } = await client
      .from('property_websites')
      .select('id,org_id,property_id')
      .not('siteforge_public_key', 'is', null)
      .limit(500)
    if (error) throw new Error(`Failed to load SiteForge websites: ${error.message}`)
    let artifacts = 0
    let proposals = 0
    let outcomes = 0
    for (const website of websites || []) {
      const result = await persistArtifactFunnelsAndIncidents(client, {
        orgId: website.org_id,
        propertyId: website.property_id,
        websiteId: website.id,
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
        rules: [
          {
            id: 'hourly-lead-conversion-floor-v1',
            metric: 'leadConversionRate',
            operator: 'lt',
            threshold: 0.01,
            minimumSessions: 100,
            severity: 'medium',
          },
        ],
      })
      artifacts += result.artifacts
      proposals += result.proposals
      outcomes += result.outcomes
    }
    const result = {
      success: true,
      websites: websites?.length || 0,
      artifacts,
      proposals,
      outcomes,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
    }
    ctx.logSuccess(200, result)
    return NextResponse.json(result, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'aggregate_siteforge_analytics' })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analytics aggregation failed' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
