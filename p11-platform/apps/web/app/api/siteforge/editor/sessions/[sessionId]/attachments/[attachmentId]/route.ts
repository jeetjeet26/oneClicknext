import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { isSiteForgeSemanticEditorEnabled } from '@/utils/siteforge/editor/feature'

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ sessionId: string; attachmentId: string }>
  }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/editor/sessions/[sessionId]/attachments/[attachmentId]'
  )
  ctx.logStart()
  if (!isSiteForgeSemanticEditorEnabled()) {
    return NextResponse.json(
      { error: 'Semantic editor is not enabled' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }

  try {
    const { sessionId, attachmentId } = await params
    if (
      !z.string().uuid().safeParse(sessionId).success ||
      !z.string().uuid().safeParse(attachmentId).success
    ) {
      return NextResponse.json(
        { error: 'Invalid editor attachment identifier' },
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
    const { data: attachment, error } = await service
      .from('siteforge_edit_attachments')
      .select(
        'id, property_id, session_id, storage_bucket, storage_path, user_message_id'
      )
      .eq('id', attachmentId)
      .eq('session_id', sessionId)
      .single()
    if (error || !attachment) {
      return NextResponse.json(
        { error: 'Editor attachment not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, attachment.property_id)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    if (attachment.user_message_id) {
      return NextResponse.json(
        { error: 'Submitted editor context is immutable' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const { error: storageError } = await service.storage
      .from(attachment.storage_bucket)
      .remove([attachment.storage_path])
    if (storageError) {
      throw new Error(
        `Failed to remove private screenshot: ${storageError.message}`
      )
    }
    const { error: deleteError } = await service
      .from('siteforge_edit_attachments')
      .delete()
      .eq('id', attachment.id)
      .is('user_message_id', null)
    if (deleteError) {
      throw new Error(
        `Failed to remove screenshot metadata: ${deleteError.message}`
      )
    }
    ctx.logSuccess(200, { attachmentId })
    return NextResponse.json(
      { success: true, attachmentId },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to remove editor screenshot' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
