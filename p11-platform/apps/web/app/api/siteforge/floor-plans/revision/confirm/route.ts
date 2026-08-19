import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { publishManualInventoryRevision } from '@/utils/siteforge/providers/manual-floor-plan-workflow'
import { queueCanonicalPreviewAfterPublication } from '@/utils/siteforge/workflows/canonical-preview-queue'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const requestSchema = z.object({
  propertyId: z.guid(),
  websiteId: z.guid(),
  expectedArtifactId: z.guid(),
  expectedCandidateContentHash: hashSchema,
  expectedInventoryContentHash: hashSchema,
  capturedAt: z.string().datetime(),
})

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/floor-plans/revision/confirm'
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
        { error: 'Invalid inventory revision confirmation request' },
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

    const service = createServiceClient()
    const revision = await publishManualInventoryRevision(
      { ...parsed.data, userId: user.id, orgId: access.orgId },
      service
    )
    const previewQueue = await queueCanonicalPreviewAfterPublication({
      service,
      orgId: access.orgId,
      propertyId: parsed.data.propertyId,
      websiteId: parsed.data.websiteId,
      artifactId: revision.artifactId,
      contentHash: revision.contentHash,
    })
    ctx.logSuccess(200, { ...revision, previewStatus: previewQueue.status })
    return NextResponse.json(
      { success: true, ...revision, previewQueue },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publish failed'
    const status = message.includes('stale') || message.includes('version conflict')
      ? 409
      : 500
    ctx.logError(status, error)
    return NextResponse.json(
      { error: message },
      { status, headers: ctx.responseHeaders }
    )
  }
}
