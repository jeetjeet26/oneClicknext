import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { createRequestContext } from '@/utils/services/request-context'
import { validateSiteForgeOwnerOperatorAccess } from '@/utils/services/auth-guard'
import { isSiteForgeRuntimeExtensionsEnabled } from '@/utils/siteforge/editor/feature'
import {
  approveAndPublishRuntimeExtension,
  ExtensionApprovalError,
  type PublishedExtensionArtifact,
} from '@/utils/siteforge/editor/extension-approval'
import {
  assertActiveAuroraLifecycleLease,
  AuroraLifecycleControlError,
  registerAuroraOwnedResource,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'
import {
  queueCanonicalPreviewAfterPublication,
  type CanonicalPreviewQueueResult,
} from '@/utils/siteforge/workflows/canonical-preview-queue'

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(1).max(2_000),
})

type ServiceClient = ReturnType<typeof createServiceClient>

function publishedIdentity(
  artifact: PublishedExtensionArtifact,
  sourceArtifactId: string
) {
  return {
    id: artifact.id,
    version: artifact.version,
    contentHash: artifact.content_hash,
    parentArtifactId: sourceArtifactId,
    themeOverlayId: artifact.theme_overlay_id,
    packageSha256: artifact.overlay_package_sha256,
  }
}

async function queuePublishedPreview(input: {
  extension: {
    org_id: string
    property_id: string
    website_id: string
  }
  artifact: PublishedExtensionArtifact
  service: ServiceClient
}): Promise<CanonicalPreviewQueueResult> {
  try {
    return await queueCanonicalPreviewAfterPublication({
      service: input.service,
      orgId: input.extension.org_id,
      propertyId: input.extension.property_id,
      websiteId: input.extension.website_id,
      artifactId: input.artifact.id,
      contentHash: input.artifact.content_hash,
    })
  } catch (error) {
    return {
      status: 'pending',
      jobId: null,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/extensions/[requestId]/decision'
  )
  ctx.logStart()
  if (!isSiteForgeRuntimeExtensionsEnabled()) {
    return NextResponse.json(
      { error: 'Runtime extensions are not enabled' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }
  try {
    const { requestId } = await params
    const parsed = decisionSchema.safeParse(await request.json())
    if (!z.string().uuid().safeParse(requestId).success || !parsed.success) {
      return NextResponse.json(
        { error: 'Invalid runtime extension decision' },
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
    const { data: extension } = await service
      .from('siteforge_runtime_extension_requests')
      .select(
        'id, org_id, property_id, website_id, artifact_id, capability, reason, requested_behavior, status, immutable_package_sha256, runtime_compatibility, decision_by, created_at'
      )
      .eq('id', requestId)
      .single()
    if (!extension) {
      return NextResponse.json(
        { error: 'Runtime extension request not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    const ownerOperator = await validateSiteForgeOwnerOperatorAccess(
      user.id,
      extension.property_id
    )
    if (
      !ownerOperator.authorized ||
      ownerOperator.orgId !== extension.org_id
    ) {
      return NextResponse.json(
        {
          error: 'SiteForge owner/operator capability required',
          capability: ownerOperator.capability,
        },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const lifecycleIdentity = await assertActiveAuroraLifecycleLease(
      request,
      {
        propertyId: extension.property_id,
        websiteId: extension.website_id,
      },
      service
    )
    if (parsed.data.decision === 'rejected') {
      if (extension.status !== 'proposed') {
        return NextResponse.json(
          { error: 'Runtime extension request has already been decided' },
          { status: 409, headers: ctx.responseHeaders }
        )
      }
      const decidedAt = new Date().toISOString()
      const { data: rejected, error: rejectionError } = await service
        .from('siteforge_runtime_extension_requests')
        .update({
          status: 'rejected',
          decision_by: user.id,
          decision_reason: parsed.data.reason,
          decided_at: decidedAt,
          updated_at: decidedAt,
        })
        .eq('id', extension.id)
        .eq('status', 'proposed')
        .select('id, status')
        .maybeSingle()
      if (rejectionError || !rejected) {
        return NextResponse.json(
          { error: 'Runtime extension request changed concurrently' },
          { status: 409, headers: ctx.responseHeaders }
        )
      }
      ctx.logSuccess(200, { requestId, decision: rejected.status })
      return NextResponse.json(
        { requestId, status: rejected.status },
        { headers: ctx.responseHeaders }
      )
    }
    const { artifact: published, reconciled } =
      await approveAndPublishRuntimeExtension({
        extension,
        decisionBy: user.id,
        decisionReason: parsed.data.reason,
        client: service,
      })
    await registerAuroraOwnedResource(
      lifecycleIdentity,
      { kind: 'artifact', id: published.id },
      service
    )
    const previewQueue = await queuePublishedPreview({
      extension,
      artifact: published,
      service,
    })
    ctx.logSuccess(200, {
      requestId,
      decision: 'approved',
      artifactId: published.id,
    })
    return NextResponse.json(
      {
        requestId,
        status: 'approved',
        artifact: publishedIdentity(published, extension.artifact_id),
        ...(reconciled ? { reconciled: true } : {}),
        previewQueue,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    if (error instanceof ExtensionApprovalError) {
      ctx.logError(error.statusCode, error)
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode, headers: ctx.responseHeaders }
      )
    }
    const status =
      error instanceof AuroraLifecycleControlError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          status === 500
            ? 'Failed to decide runtime extension request'
            : (error as Error).message,
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
