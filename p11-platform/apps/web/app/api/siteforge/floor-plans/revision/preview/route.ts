import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { createManualInventoryRevisionPreview } from '@/utils/siteforge/providers/manual-floor-plan-workflow'

const requestSchema = z.object({
  propertyId: z.guid(),
  websiteId: z.guid(),
})

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/floor-plans/revision/preview'
  )
  ctx.logStart()
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid inventory revision preview request' },
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

    const preview = await createManualInventoryRevisionPreview(
      { ...parsed.data, orgId: access.orgId },
      createServiceClient()
    )
    ctx.logSuccess(200, {
      websiteId: preview.websiteId,
      artifactId: preview.artifactId,
      changedBlockCount: preview.changedBlockCount,
    })
    return NextResponse.json(
      {
        websiteId: preview.websiteId,
        artifactId: preview.artifactId,
        artifactVersion: preview.artifactVersion,
        candidateContentHash: preview.candidateContentHash,
        inventoryContentHash: preview.inventoryContentHash,
        changedBlockCount: preview.changedBlockCount,
        capturedAt: preview.blueprint.updatedAt,
        blocks: preview.blocks,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Preview failed'
    const status = message.includes('no current artifact') ||
      message.includes('no floor-plan blocks') ? 409 : 500
    ctx.logError(status, error)
    return NextResponse.json(
      { error: message },
      { status, headers: ctx.responseHeaders }
    )
  }
}
