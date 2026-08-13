import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { authorizeSiteForgeWebsite } from '@/utils/siteforge/operations-auth'
import {
  buildSiteForgeOwnershipReport,
  siteForgeReportCsv,
} from '@/utils/siteforge/operations/analytics'

const querySchema = z.object({
  websiteId: z.string().uuid(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  format: z.enum(['json', 'csv']).default('json'),
})

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/reporting')
  const params = new URL(request.url).searchParams
  const parsed = querySchema.safeParse({
    websiteId: params.get('websiteId'),
    start: params.get('start') || undefined,
    end: params.get('end') || undefined,
    format: params.get('format') || undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Valid websiteId, date window, and export format are required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const end = parsed.data.end ? new Date(parsed.data.end) : new Date()
  const start = parsed.data.start
    ? new Date(parsed.data.start)
    : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1_000)
  if (
    start >= end ||
    end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1_000
  ) {
    return NextResponse.json(
      { error: 'Reporting window must be positive and no longer than 366 days' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorizeSiteForgeWebsite(parsed.data.websiteId)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  try {
    const report = await buildSiteForgeOwnershipReport(auth.service, {
      orgId: auth.website.org_id,
      propertyId: auth.website.property_id,
      websiteId: auth.website.id,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
    })
    if (parsed.data.format === 'csv') {
      return new NextResponse(siteForgeReportCsv(report), {
        headers: {
          ...ctx.responseHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="siteforge-${auth.website.id}.csv"`,
        },
      })
    }
    return NextResponse.json(report, { headers: ctx.responseHeaders })
  } catch (cause) {
    ctx.logError(500, cause)
    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : 'Failed to build SiteForge ownership report',
      },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
