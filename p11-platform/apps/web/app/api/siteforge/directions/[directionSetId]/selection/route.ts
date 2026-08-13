import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  confirmSiteForgeCreativeDirectionSelection,
  SiteForgeDirectionError,
} from '@/utils/siteforge/directions/repository'

const selectionSchema = z.object({
  propertyId: z.guid(),
  selectedDirectionId: z.string().uuid(),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  selectionNotes: z.string().trim().max(2_000).nullable().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ directionSetId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/directions/[directionSetId]/selection'
  )
  ctx.logStart()
  try {
    const { directionSetId } = await params
    if (!z.string().uuid().safeParse(directionSetId).success) {
      return NextResponse.json(
        { error: 'Invalid creative direction set identifier' },
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
    const parsed = selectionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid creative direction selection' },
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
    const directionSet = await confirmSiteForgeCreativeDirectionSelection({
      directionSetId,
      ...parsed.data,
      reviewerProfileId: user.id,
    })
    ctx.logSuccess(200, {
      directionSetId,
      propertyId: parsed.data.propertyId,
      selectedDirectionId: parsed.data.selectedDirectionId,
    })
    return NextResponse.json(
      { success: true, directionSet },
      { headers: ctx.responseHeaders }
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
            : 'Failed to select creative direction',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
