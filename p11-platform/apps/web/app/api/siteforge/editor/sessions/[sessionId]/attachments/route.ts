import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { isSiteForgeSemanticEditorEnabled } from '@/utils/siteforge/editor/feature'
import {
  SITEFORGE_EDITOR_ATTACHMENT_BUCKET,
  SITEFORGE_EDITOR_ATTACHMENT_MAX_BYTES,
  SITEFORGE_EDITOR_ATTACHMENT_MIME_TYPES,
  siteForgeEditorAttachmentContextSchema,
  siteForgeEditorAttachmentExtension,
  siteForgeEditorAttachmentSha256,
} from '@/utils/siteforge/editor/attachments'

const dimensionSchema = z.coerce.number().int().positive().max(20_000).optional()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/editor/sessions/[sessionId]/attachments'
  )
  ctx.logStart()
  if (!isSiteForgeSemanticEditorEnabled()) {
    return NextResponse.json(
      { error: 'Semantic editor is not enabled' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }

  let uploadedPath: string | null = null
  try {
    const { sessionId } = await params
    if (!z.string().uuid().safeParse(sessionId).success) {
      return NextResponse.json(
        { error: 'Invalid editor session identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const formData = await request.formData()
    const file = formData.get('file')
    const context = siteForgeEditorAttachmentContextSchema.safeParse({
      expectedArtifactId: formData.get('expectedArtifactId'),
      expectedContentHash: formData.get('expectedContentHash'),
      pageSlug: formData.get('pageSlug'),
      viewport: formData.get('viewport'),
    })
    const width = dimensionSchema.safeParse(formData.get('width') || undefined)
    const height = dimensionSchema.safeParse(formData.get('height') || undefined)
    if (
      !(file instanceof File) ||
      !context.success ||
      !width.success ||
      !height.success ||
      !SITEFORGE_EDITOR_ATTACHMENT_MIME_TYPES.includes(
        file.type as (typeof SITEFORGE_EDITOR_ATTACHMENT_MIME_TYPES)[number]
      ) ||
      file.size < 1 ||
      file.size > SITEFORGE_EDITOR_ATTACHMENT_MAX_BYTES
    ) {
      return NextResponse.json(
        { error: 'Invalid editor screenshot attachment' },
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
    const { data: session, error: sessionError } = await service
      .from('siteforge_edit_sessions')
      .select('id, org_id, property_id, website_id, active_artifact_id, status')
      .eq('id', sessionId)
      .single()
    if (sessionError || !session || session.status !== 'active') {
      return NextResponse.json(
        { error: 'Active editor session not found' },
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
    if (session.active_artifact_id !== context.data.expectedArtifactId) {
      return NextResponse.json(
        { error: 'Artifact changed; reload before attaching a screenshot' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const [{ data: website }, { data: artifact }] = await Promise.all([
      service
        .from('property_websites')
        .select('current_artifact_version_id')
        .eq('id', session.website_id)
        .eq('property_id', session.property_id)
        .eq('org_id', session.org_id)
        .single(),
      service
        .from('siteforge_blueprint_versions')
        .select('id, content_hash')
        .eq('id', context.data.expectedArtifactId)
        .eq('website_id', session.website_id)
        .eq('property_id', session.property_id)
        .eq('org_id', session.org_id)
        .single(),
    ])
    if (
      website?.current_artifact_version_id !== context.data.expectedArtifactId ||
      artifact?.content_hash !== context.data.expectedContentHash
    ) {
      return NextResponse.json(
        { error: 'Artifact changed; reload before attaching a screenshot' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const attachmentId = randomUUID()
    const extension = siteForgeEditorAttachmentExtension(file.type)
    uploadedPath = [
      'editor-context',
      session.org_id,
      session.property_id,
      session.website_id,
      artifact.id,
      session.id,
      `${attachmentId}.${extension}`,
    ].join('/')
    const { error: uploadError } = await service.storage
      .from(SITEFORGE_EDITOR_ATTACHMENT_BUCKET)
      .upload(uploadedPath, bytes, {
        contentType: file.type,
        upsert: false,
      })
    if (uploadError) {
      throw new Error(`Failed to store private screenshot: ${uploadError.message}`)
    }

    const originalFilename =
      file.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) ||
      `screenshot.${extension}`
    const { data: attachment, error: insertError } = await service
      .from('siteforge_edit_attachments')
      .insert({
        id: attachmentId,
        session_id: session.id,
        org_id: session.org_id,
        property_id: session.property_id,
        website_id: session.website_id,
        artifact_id: artifact.id,
        artifact_content_hash: artifact.content_hash,
        page_slug: context.data.pageSlug,
        viewport: context.data.viewport,
        storage_bucket: SITEFORGE_EDITOR_ATTACHMENT_BUCKET,
        storage_path: uploadedPath,
        byte_sha256: siteForgeEditorAttachmentSha256(bytes),
        mime_type: file.type,
        file_size_bytes: bytes.byteLength,
        original_filename: originalFilename,
        width: width.data || null,
        height: height.data || null,
        created_by: user.id,
      })
      .select(
        'id, user_message_id, artifact_id, artifact_content_hash, page_slug, viewport, mime_type, file_size_bytes, original_filename, width, height, created_at'
      )
      .single()
    if (insertError || !attachment) {
      await service.storage
        .from(SITEFORGE_EDITOR_ATTACHMENT_BUCKET)
        .remove([uploadedPath])
      uploadedPath = null
      throw new Error(
        `Failed to persist screenshot metadata: ${
          insertError?.message || 'missing row'
        }`
      )
    }
    const { data: signed, error: signedError } = await service.storage
      .from(SITEFORGE_EDITOR_ATTACHMENT_BUCKET)
      .createSignedUrl(uploadedPath, 15 * 60)
    if (signedError || !signed?.signedUrl) {
      throw new Error(
        `Failed to authorize screenshot preview: ${
          signedError?.message || attachment.id
        }`
      )
    }

    ctx.logSuccess(201, { attachmentId: attachment.id })
    return NextResponse.json(
      { attachment: { ...attachment, signedUrl: signed.signedUrl } },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to attach editor screenshot' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
