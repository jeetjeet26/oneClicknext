import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { guidedPrepareRequestSchema } from '@/utils/siteforge/guided/contracts'
import {
  siteForgeGuidedService,
  toSiteForgeGuidedError,
} from '@/utils/siteforge/guided/service'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/guided/[websiteId]/prepare'
  )
  ctx.logStart()
  try {
    const { websiteId } = await params
    if (!z.guid().safeParse(websiteId).success) {
      return NextResponse.json(
        { error: 'Invalid website identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const parsed = guidedPrepareRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'A stable preparation request key is required.' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const { data: website } = await createServiceClient()
      .from('property_websites')
      .select('property_id')
      .eq('id', websiteId)
      .maybeSingle()
    if (!website) {
      return NextResponse.json(
        { error: 'SiteForge website not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, website.property_id)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const result = await siteForgeGuidedService().prepare(
      websiteId,
      parsed.data,
      user.id
    )
    ctx.logSuccess(200, {
      websiteId,
      propertyId: website.property_id,
      duplicate: result.duplicate,
    })
    return NextResponse.json(result, {
      headers: {
        ...ctx.responseHeaders,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    const classified = toSiteForgeGuidedError(error)
    ctx.logError(classified.statusCode, error)
    return NextResponse.json(
      {
        error: classified.message,
        classification: classified.kind,
        retryable: classified.retryable,
      },
      { status: classified.statusCode, headers: ctx.responseHeaders }
    )
  }
}
