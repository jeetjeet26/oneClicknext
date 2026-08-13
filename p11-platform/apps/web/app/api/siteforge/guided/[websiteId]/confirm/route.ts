import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { guidedConfirmRequestSchema } from '@/utils/siteforge/guided/contracts'
import {
  SiteForgeGuidedError,
  siteForgeGuidedService,
  toSiteForgeGuidedError,
} from '@/utils/siteforge/guided/service'
import { POST as generateWebsite } from '@/app/api/siteforge/generate/route'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/guided/[websiteId]/confirm'
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
    const parsed = guidedConfirmRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Reload the recommendation before building.' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const serviceClient = createServiceClient()
    const [{ data: website }, { data: profile }] = await Promise.all([
      serviceClient
        .from('property_websites')
        .select('property_id')
        .eq('id', websiteId)
        .maybeSingle(),
      serviceClient.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    ])
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
    if (!profile || !['admin', 'manager'].includes(profile.role || '')) {
      return NextResponse.json(
        { error: 'Build approval requires an admin or manager.' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }

    const result = await siteForgeGuidedService().confirm(
      websiteId,
      parsed.data,
      user.id,
      async generationInput => {
        const generationRequest = new NextRequest(
          new URL('/api/siteforge/generate', request.url),
          {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(generationInput),
          }
        )
        const response = await generateWebsite(generationRequest)
        const payload = (await response.json()) as Record<string, unknown>
        if (!response.ok || typeof payload.jobId !== 'string') {
          throw new SiteForgeGuidedError(
            response.status === 409
              ? 'The approved build inputs changed before generation started.'
              : 'SiteForge could not start the build right now. The confirmed recommendation is saved.',
            response.status === 409 ? 409 : 503,
            response.status === 409 ? 'source_changed' : 'temporary',
            response.status !== 409
          )
        }
        return {
          jobId: payload.jobId,
          status:
            typeof payload.status === 'string' ? payload.status : 'queued',
          workflowRunId:
            typeof payload.workflowRunId === 'string'
              ? payload.workflowRunId
              : null,
          duplicate: payload.duplicate === true,
        }
      }
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
