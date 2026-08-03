import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { isSiteForgeSemanticEditorEnabled } from '@/utils/siteforge/editor/feature'
import { listEditorMessages } from '@/utils/siteforge/editor/repository'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/editor/sessions/[sessionId]'
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
      .select(
        '*, property_websites!inner(current_artifact_version_id, editor_lifecycle_status, canonical_preview_url, canonical_preview_artifact_id, staging_url, staging_artifact_id, staging_certified_at)'
      )
      .eq('id', sessionId)
      .single()
    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Editor session not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    const access = await validatePropertyAccess(user.id, session.property_id)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }

    const messages = await listEditorMessages(session.id, serviceClient)
    return NextResponse.json(
      { session, messages },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to load editor session',
      },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
