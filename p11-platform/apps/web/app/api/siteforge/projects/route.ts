import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  createOrReuseSiteForgeProject,
  SiteForgeProjectError,
} from '@/utils/siteforge/projects/repository'

const projectRequestSchema = z
  .object({
    propertyId: z.guid(),
  })
  .strict()

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/projects')
  ctx.logStart()
  try {
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

    const parsed = projectRequestSchema.safeParse(
      await request.json().catch(() => null)
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'A valid propertyId is required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }

    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized || !access.orgId) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }

    const result = await createOrReuseSiteForgeProject({
      orgId: access.orgId,
      propertyId: parsed.data.propertyId,
    })
    ctx.logSuccess(result.reused ? 200 : 201, {
      websiteId: result.project.websiteId,
      propertyId: result.project.propertyId,
      reused: result.reused,
    })
    return NextResponse.json(result, {
      status: result.reused ? 200 : 201,
      headers: ctx.responseHeaders,
    })
  } catch (error) {
    const status =
      error instanceof SiteForgeProjectError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof SiteForgeProjectError
            ? error.message
            : 'Failed to prepare SiteForge project',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
