import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { isSiteForgeSemanticEditorEnabled } from '@/utils/siteforge/editor/feature'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const ctx = createRequestContext(request, '/api/siteforge/editor/jobs/[jobId]')
  if (!isSiteForgeSemanticEditorEnabled()) {
    return NextResponse.json(
      { error: 'Semantic editor is not enabled' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }

  const { jobId } = await params
  if (!z.string().uuid().safeParse(jobId).success) {
    return NextResponse.json(
      { error: 'Invalid editor job identifier' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: ctx.responseHeaders }
    )
  }

  const serviceClient = createServiceClient()
  const { data: job, error } = await serviceClient
    .from('shared_jobs')
    .select(
      'id, property_id, subject_id, lifecycle_status, status_reason, stage, progress, current_step, cancel_requested, output, error_message, error_details, workflow_run_id, queued_at, started_at, finished_at, updated_at'
    )
    .eq('id', jobId)
    .eq('domain', 'siteforge.semantic_edit')
    .single()
  if (error || !job?.property_id) {
    return NextResponse.json(
      { error: 'Editor job not found' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }

  const access = await validatePropertyAccess(user.id, job.property_id)
  if (!access.authorized) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: ctx.responseHeaders }
    )
  }

  const { data: message } = await serviceClient
    .from('siteforge_edit_messages')
    .select(
      'id, session_id, status, content, resulting_artifact_id, tool_summary, progress, failure_code, failure_message, completed_at'
    )
    .eq('shared_job_id', job.id)
    .maybeSingle()

  return NextResponse.json(
    { job, message },
    {
      headers: {
        ...ctx.responseHeaders,
        'Cache-Control': 'no-store',
      },
    }
  )
}
