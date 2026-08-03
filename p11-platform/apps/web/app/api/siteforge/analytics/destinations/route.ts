import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { authorizeSiteForgeWebsite } from '@/utils/siteforge/operations-auth'
import { upsertValidatedAnalyticsDestination } from '@/utils/siteforge/operations/analytics'

const saveSchema = z.object({
  websiteId: z.string().uuid(),
  destination: z.unknown(),
}).strict()

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/analytics/destinations')
  const websiteId = new URL(request.url).searchParams.get('websiteId')
  if (!websiteId || !z.string().uuid().safeParse(websiteId).success) {
    return NextResponse.json(
      { error: 'Valid websiteId is required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorizeSiteForgeWebsite(websiteId)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  const { data, error } = await auth.service
    .from('siteforge_analytics_destinations')
    .select('id, destination_type, destination_identity, consent_mode, enabled, created_at, updated_at')
    .eq('website_id', websiteId)
    .order('created_at', { ascending: true })
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
  return NextResponse.json({ destinations: data || [] }, { headers: ctx.responseHeaders })
}

export async function PUT(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/analytics/destinations')
  const parsed = saveSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Valid website and analytics destination are required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorizeSiteForgeWebsite(parsed.data.websiteId, true)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  try {
    const destination = await upsertValidatedAnalyticsDestination(
      auth.service,
      {
        orgId: auth.website.org_id,
        propertyId: auth.website.property_id,
        websiteId: parsed.data.websiteId,
      },
      parsed.data.destination
    )
    return NextResponse.json(
      { destination },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid analytics destination' },
      { status: 422, headers: ctx.responseHeaders }
    )
  }
}
