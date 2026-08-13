import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  createSiteForgeDirectionSet,
  listSiteForgeDirectionSets,
  SiteForgeDirectionError,
} from '@/utils/siteforge/directions/repository'

const createSchema = z.object({
  briefVersionId: z.string().uuid(),
  propertyId: z.guid(),
  expectedSetVersion: z.number().int().nonnegative().nullable().optional(),
})

async function authenticate() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  return error || !user ? null : user
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
  const ctx = createRequestContext(request, '/api/siteforge/directions')
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
    const directionSets = await listSiteForgeDirectionSets({
      websiteId: websiteId || undefined,
      propertyId: websiteId ? undefined : propertyId,
    })
    ctx.logSuccess(200, { propertyId, count: directionSets.length })
    return NextResponse.json(
      { directionSets },
      {
        headers: {
          ...ctx.responseHeaders,
          'Cache-Control': 'private, no-store',
        },
      }
    )
  } catch (error) {
    const status =
      error instanceof SiteForgeDirectionError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof SiteForgeDirectionError
            ? error.message
            : 'Failed to load creative directions',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/directions')
  ctx.logStart()
  try {
    const user = await authenticate()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const parsed = createSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid creative direction request' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const directionSet = await createSiteForgeDirectionSet({
      ...parsed.data,
      userId: user.id,
    })
    ctx.logSuccess(201, {
      directionSetId: directionSet.id,
      websiteId: directionSet.websiteId,
      propertyId: directionSet.propertyId,
    })
    return NextResponse.json(
      { success: true, directionSet },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof SiteForgeDirectionError
        ? error.statusCode
        : error instanceof z.ZodError
          ? 400
          : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof SiteForgeDirectionError
            ? error.message
            : status === 400
              ? 'Creative direction content is invalid'
              : 'Failed to create creative directions',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
