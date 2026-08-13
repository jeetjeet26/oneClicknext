import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  loadSiteForgeDirectorSnapshot,
  SiteForgeDirectorError,
} from '@/utils/siteforge/director/snapshot'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/director/[websiteId]'
  )
  ctx.logStart()

  try {
    const { websiteId } = await params
    if (!z.string().uuid().safeParse(websiteId).success) {
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

    const service = createServiceClient()
    const { data: website, error: websiteError } = await service
      .from('property_websites')
      .select('id, property_id')
      .eq('id', websiteId)
      .maybeSingle()
    if (websiteError || !website) {
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

    const snapshot = await loadSiteForgeDirectorSnapshot(website.id, service)
    ctx.logSuccess(200, {
      websiteId: website.id,
      propertyId: website.property_id,
      stage: snapshot.stage.key,
      blockers: snapshot.blockers.length,
    })
    return NextResponse.json(snapshot, {
      headers: {
        ...ctx.responseHeaders,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    const status =
      error instanceof SiteForgeDirectorError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          status === 500
            ? 'Failed to assemble SiteForge Director snapshot'
            : (error as Error).message,
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
