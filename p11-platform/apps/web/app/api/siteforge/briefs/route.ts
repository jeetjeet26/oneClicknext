import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  createSiteForgeBriefVersion,
  listSiteForgeBriefVersions,
  SiteForgeBriefError,
} from '@/utils/siteforge/briefs/repository'

const createBriefSchema = z.object({
  websiteId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative().nullable().optional(),
  status: z.enum(['draft', 'ready_for_review']).optional(),
  brief: z.unknown(),
  unresolvedContradictions: z.unknown().optional(),
})

async function authenticate() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

async function websitePropertyId(websiteId: string) {
  const { data } = await createServiceClient()
    .from('property_websites')
    .select('property_id')
    .eq('id', websiteId)
    .maybeSingle()
  return data?.property_id || null
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/briefs')
  ctx.logStart()
  try {
    const user = await authenticate()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const search = new URL(request.url).searchParams
    const websiteId = search.get('websiteId')
    const requestedPropertyId = search.get('propertyId')
    if (
      (websiteId && !z.string().uuid().safeParse(websiteId).success) ||
      (requestedPropertyId &&
        !z.guid().safeParse(requestedPropertyId).success) ||
      (!websiteId && !requestedPropertyId)
    ) {
      return NextResponse.json(
        { error: 'A valid websiteId or propertyId is required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const propertyId = websiteId
      ? await websitePropertyId(websiteId)
      : requestedPropertyId
    if (!propertyId) {
      return NextResponse.json(
        { error: 'SiteForge website not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const briefs = await listSiteForgeBriefVersions({
      websiteId: websiteId || undefined,
      propertyId: websiteId ? undefined : propertyId,
    })
    ctx.logSuccess(200, { propertyId, count: briefs.length })
    return NextResponse.json(
      { briefs },
      {
        headers: {
          ...ctx.responseHeaders,
          'Cache-Control': 'private, no-store',
        },
      }
    )
  } catch (error) {
    const status =
      error instanceof SiteForgeBriefError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof SiteForgeBriefError
            ? error.message
            : 'Failed to load SiteForge briefs',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/briefs')
  ctx.logStart()
  try {
    const user = await authenticate()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const parsed = createBriefSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid SiteForge brief request' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const propertyId = await websitePropertyId(parsed.data.websiteId)
    if (!propertyId) {
      return NextResponse.json(
        { error: 'SiteForge website not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const brief = await createSiteForgeBriefVersion({
      ...parsed.data,
      userId: user.id,
    })
    ctx.logSuccess(201, {
      websiteId: brief.websiteId,
      propertyId: brief.propertyId,
      briefVersionId: brief.id,
      version: brief.version,
    })
    return NextResponse.json(
      { success: true, brief },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof SiteForgeBriefError
        ? error.statusCode
        : error instanceof z.ZodError
          ? 400
          : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof SiteForgeBriefError
            ? error.message
            : status === 400
              ? 'Brief content is invalid'
              : 'Failed to persist SiteForge brief',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
