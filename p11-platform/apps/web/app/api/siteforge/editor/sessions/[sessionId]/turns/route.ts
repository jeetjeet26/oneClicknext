import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRun, start } from 'workflow/api'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validateSiteForgeOwnerOperatorAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { isSiteForgeSemanticEditorEnabled } from '@/utils/siteforge/editor/feature'
import { createEditorMessage } from '@/utils/siteforge/editor/repository'
import { siteForgeSemanticEditWorkflow } from '@/workflows/siteforge-semantic-edit'
import type { Json } from '@/types/supabase'
import {
  assertActiveAuroraLifecycleLease,
  AuroraLifecycleControlError,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'
import { siteForgeEditorScopeSchema } from '@/utils/siteforge/editor/scope'
import { siteForgeEditorAttachmentIdsSchema } from '@/utils/siteforge/editor/attachments'
import {
  pageManagerActionSummary,
  siteForgePageManagerActionSchema,
} from '@/utils/siteforge/editor/page-manager'

export const turnSchema = z.object({
  userIntent: z.string().trim().min(1).max(8_000),
  expectedArtifactId: z.string().uuid(),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  clientRequestId: z.string().trim().min(8).max(160),
  elementContext: z
    .object({
      pageSlug: z.string().trim().min(1).max(160),
      sectionId: z.string().trim().min(1).max(200),
      blockType: z.string().trim().min(1).max(160).optional(),
    })
    .strict()
    .optional(),
  editScope: siteForgeEditorScopeSchema.optional(),
  pageManagerAction: siteForgePageManagerActionSchema.optional(),
  attachmentIds: siteForgeEditorAttachmentIdsSchema.optional(),
})
  .strict()
  .superRefine((value, context) => {
    if (value.pageManagerAction && value.elementContext) {
      context.addIssue({
        code: 'custom',
        path: ['elementContext'],
        message: 'Structured page management cannot target one section',
      })
    }
  })

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/editor/sessions/[sessionId]/turns'
  )
  ctx.logStart()

  if (!isSiteForgeSemanticEditorEnabled()) {
    return NextResponse.json(
      { error: 'Semantic editor is not enabled' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }

  try {
    const { sessionId } = await params
    if (!z.string().uuid().safeParse(sessionId).success) {
      return NextResponse.json(
        { error: 'Invalid editor session identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const parsed = turnSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid semantic edit turn' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const effectiveUserIntent = parsed.data.pageManagerAction
      ? pageManagerActionSummary(parsed.data.pageManagerAction)
      : parsed.data.userIntent
    const effectiveEditScope = parsed.data.pageManagerAction
      ? ({ kind: 'site' } as const)
      : parsed.data.editScope

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

    const serviceClient = createServiceClient()
    const { data: session, error: sessionError } = await serviceClient
      .from('siteforge_edit_sessions')
      .select('id, org_id, property_id, website_id, status, active_artifact_id')
      .eq('id', sessionId)
      .single()
    if (sessionError || !session || session.status !== 'active') {
      return NextResponse.json(
        { error: 'Active editor session not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    const access = await validateSiteForgeOwnerOperatorAccess(
      user.id,
      session.property_id
    )
    if (!access.authorized) {
      return NextResponse.json(
        {
          error: 'SiteForge owner/operator capability required',
          capability: access.capability,
        },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const lifecycleIdentity = await assertActiveAuroraLifecycleLease(
      request,
      {
        propertyId: session.property_id,
        websiteId: session.website_id,
      },
      serviceClient
    )

    const dedupeKey = `${session.id}:${parsed.data.clientRequestId}`
    const { data: duplicateJob } = await serviceClient
      .from('shared_jobs')
      .select('id, lifecycle_status')
      .eq('domain', 'siteforge.semantic_edit')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle()
    if (duplicateJob) {
      // Only the assistant message carries shared_job_id (unique per job);
      // the user message is resolved through its client request identity.
      const [{ data: assistantMessage }, { data: userMessage }] =
        await Promise.all([
          serviceClient
            .from('siteforge_edit_messages')
            .select('id, role, status, resulting_artifact_id')
            .eq('session_id', session.id)
            .eq('shared_job_id', duplicateJob.id)
            .maybeSingle(),
          serviceClient
            .from('siteforge_edit_messages')
            .select('id')
            .eq('session_id', session.id)
            .eq('client_request_id', parsed.data.clientRequestId)
            .maybeSingle(),
        ])
      return NextResponse.json(
        {
          duplicate: true,
          userMessageId: userMessage?.id || null,
          assistantMessageId: assistantMessage?.id || null,
          jobId: duplicateJob.id,
          status: duplicateJob.lifecycle_status,
          artifactId: assistantMessage?.resulting_artifact_id || null,
        },
        { headers: ctx.responseHeaders }
      )
    }

    if (session.active_artifact_id !== parsed.data.expectedArtifactId) {
      return NextResponse.json(
        { error: 'Artifact changed; reload the editor before submitting' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const { data: website, error: websiteError } = await serviceClient
      .from('property_websites')
      .select('current_artifact_version_id')
      .eq('id', session.website_id)
      .eq('property_id', session.property_id)
      .eq('org_id', session.org_id)
      .single()
    const { data: artifact, error: artifactError } = await serviceClient
      .from('siteforge_blueprint_versions')
      .select('id, content_hash')
      .eq('id', parsed.data.expectedArtifactId)
      .eq('website_id', session.website_id)
      .single()
    if (
      websiteError ||
      artifactError ||
      !website ||
      !artifact ||
      website.current_artifact_version_id !== artifact.id ||
      artifact.content_hash !== parsed.data.expectedContentHash
    ) {
      return NextResponse.json(
        { error: 'Artifact changed; reload the editor before submitting' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const { data: conflictingJob } = await serviceClient
      .from('shared_jobs')
      .select('id, lifecycle_status, stage, current_step')
      .eq('domain', 'siteforge.semantic_edit')
      .eq('subject_id', session.website_id)
      .in('lifecycle_status', ['queued', 'running', 'retrying'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (conflictingJob) {
      return NextResponse.json(
        {
          error: 'Another semantic edit is already active for this website',
          activeJob: conflictingJob,
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const attachmentIds = parsed.data.attachmentIds || []
    const attachmentResult = attachmentIds.length
      ? await serviceClient
          .from('siteforge_edit_attachments')
          .select(
            'id, session_id, org_id, property_id, website_id, artifact_id, artifact_content_hash, user_message_id'
          )
          .in('id', attachmentIds)
          .eq('session_id', session.id)
          .eq('org_id', session.org_id)
          .eq('property_id', session.property_id)
          .eq('website_id', session.website_id)
          .eq('artifact_id', artifact.id)
          .eq('artifact_content_hash', artifact.content_hash)
          .is('user_message_id', null)
      : { data: [], error: null }
    if (
      attachmentResult.error ||
      attachmentResult.data?.length !== attachmentIds.length
    ) {
      return NextResponse.json(
        {
          error:
            'One or more screenshots no longer match this editor session and artifact',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const now = new Date().toISOString()
    const { data: job, error: jobError } = await serviceClient
      .from('shared_jobs')
      .insert({
        org_id: session.org_id,
        property_id: session.property_id,
        domain: 'siteforge.semantic_edit',
        subject_type: 'property_website',
        subject_id: session.website_id,
        lifecycle_status: 'queued',
        status_reason: 'workflow_starting',
        dedupe_key: dedupeKey,
        payload: {
          sessionId: session.id,
          expectedArtifactId: artifact.id,
          expectedContentHash: artifact.content_hash,
          elementContext: parsed.data.elementContext || null,
          editScope: effectiveEditScope || null,
          pageManagerAction: parsed.data.pageManagerAction || null,
          attachmentIds,
          ...(lifecycleIdentity
            ? {
                lifecycleOwnerId: lifecycleIdentity.ownerId,
                lifecycleRunId: lifecycleIdentity.ownerId,
                lifecycleExpiresAt: lifecycleIdentity.expiresAt,
              }
            : {}),
        } as Json,
        stage: 'queued',
        progress: 0,
        current_step: 'Preparing semantic edit',
        attempt_count: 1,
        queued_at: now,
        updated_at: now,
      })
      .select('id')
      .single()
    if (jobError?.code === '23505') {
      const { data: activeJob } = await serviceClient
        .from('shared_jobs')
        .select('id, lifecycle_status, stage, current_step')
        .eq('domain', 'siteforge.semantic_edit')
        .eq('subject_id', session.website_id)
        .in('lifecycle_status', ['queued', 'running', 'retrying'])
        .maybeSingle()
      return NextResponse.json(
        {
          error: 'Another semantic edit is already active for this website',
          activeJob: activeJob || null,
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    if (jobError || !job) {
      return NextResponse.json(
        { error: 'Failed to create durable semantic edit job' },
        { status: 500, headers: ctx.responseHeaders }
      )
    }

    let userMessageId: string | null = null
    let assistantMessageId: string | null = null
    let workflowRunId: string | null = null
    try {
      const userMessage = await createEditorMessage(
        {
          sessionId: session.id,
          orgId: session.org_id,
          propertyId: session.property_id,
          websiteId: session.website_id,
          role: 'user',
          content: effectiveUserIntent,
          clientRequestId: parsed.data.clientRequestId,
          parentArtifactId: artifact.id,
          parentContentHash: artifact.content_hash,
          // shared_job_id is unique per job and reserved for the assistant
          // message, which the job status route resolves by that column.
          createdBy: user.id,
        },
        serviceClient
      )
      userMessageId = userMessage.id
      if (attachmentIds.length) {
        const { data: boundAttachments, error: bindError } = await serviceClient
          .from('siteforge_edit_attachments')
          .update({ user_message_id: userMessage.id })
          .in('id', attachmentIds)
          .eq('session_id', session.id)
          .is('user_message_id', null)
          .select('id')
        if (
          bindError ||
          boundAttachments?.length !== attachmentIds.length
        ) {
          throw new Error(
            `Failed to bind immutable screenshot context: ${
              bindError?.message || 'attachment changed'
            }`
          )
        }
      }
      const assistantMessage = await createEditorMessage(
        {
          sessionId: session.id,
          orgId: session.org_id,
          propertyId: session.property_id,
          websiteId: session.website_id,
          role: 'assistant',
          status: 'queued',
          content: 'Preparing your edit…',
          parentArtifactId: artifact.id,
          parentContentHash: artifact.content_hash,
          sharedJobId: job.id,
        },
        serviceClient
      )
      assistantMessageId = assistantMessage.id
      const run = await start(siteForgeSemanticEditWorkflow, [
        {
          sharedJobId: job.id,
          sessionId: session.id,
          userMessageId,
          assistantMessageId,
          websiteId: session.website_id,
          propertyId: session.property_id,
          orgId: session.org_id,
          userId: user.id,
          userIntent: effectiveUserIntent,
          attachmentIds,
          elementContext: parsed.data.elementContext,
          editScope: effectiveEditScope,
          pageManagerAction: parsed.data.pageManagerAction,
          expectedArtifactId: artifact.id,
          expectedContentHash: artifact.content_hash,
        },
      ])
      workflowRunId = run.runId
      const { data: linkedJob, error: linkError } = await serviceClient
        .from('shared_jobs')
        .update({
          workflow_run_id: run.runId,
          workflow_name: 'siteforge-semantic-edit',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('lifecycle_status', 'queued')
        .select('id')
        .maybeSingle()
      if (linkError || !linkedJob) {
        throw new Error(
          `Failed to link semantic edit workflow: ${
            linkError?.message || 'job changed'
          }`
        )
      }
    } catch (startupError) {
      const failedAt = new Date().toISOString()
      if (workflowRunId) {
        await getRun(workflowRunId).cancel().catch(() => undefined)
      }
      const cleanup: Array<Promise<unknown>> = [
        Promise.resolve(
          serviceClient
          .from('shared_jobs')
          .update({
            lifecycle_status: 'failed',
            status_reason: 'workflow_start_failed',
            stage: 'failed',
            current_step: 'Semantic edit workflow failed to start',
            error_message:
              startupError instanceof Error
                ? startupError.message
                : 'Semantic edit workflow failed to start',
            finished_at: failedAt,
            updated_at: failedAt,
          })
          .eq('id', job.id)
          .eq('lifecycle_status', 'queued')
        ),
      ]
      if (assistantMessageId) {
        cleanup.push(
          Promise.resolve(
            serviceClient
            .from('siteforge_edit_messages')
            .update({
              status: 'failed',
              content:
                'The edit workflow could not start. Retry this request after checking the current revision.',
              failure_code: 'workflow_start_failed',
              failure_message:
                startupError instanceof Error
                  ? startupError.message
                  : 'Semantic edit workflow failed to start',
              completed_at: failedAt,
            })
            .eq('id', assistantMessageId)
            .eq('status', 'queued')
          )
        )
      }
      await Promise.all(cleanup)
      throw startupError
    }

    return NextResponse.json(
      {
        sessionId: session.id,
        userMessageId,
        assistantMessageId,
        jobId: job.id,
        workflowRunId,
        status: 'queued',
      },
      { status: 202, headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof AuroraLifecycleControlError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          status === 500
            ? 'Failed to submit semantic edit'
            : (error as Error).message,
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
