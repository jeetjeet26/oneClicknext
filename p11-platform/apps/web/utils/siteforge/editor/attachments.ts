import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database, Tables } from '@/types/supabase'

export const SITEFORGE_EDITOR_ATTACHMENT_BUCKET = 'siteforge-artifacts'
export const SITEFORGE_EDITOR_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024
export const SITEFORGE_EDITOR_ATTACHMENT_MAX_COUNT = 6
export const SITEFORGE_EDITOR_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const siteForgeEditorAttachmentContextSchema = z
  .object({
    expectedArtifactId: z.string().uuid(),
    expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    pageSlug: z.string().trim().min(1).max(160),
    viewport: z.enum(['mobile', 'tablet', 'desktop']),
  })
  .strict()

export const siteForgeEditorAttachmentIdsSchema = z
  .array(z.string().uuid())
  .max(SITEFORGE_EDITOR_ATTACHMENT_MAX_COUNT)
  .default([])
  .refine(ids => new Set(ids).size === ids.length, {
    message: 'Attachment identifiers must be unique',
  })

export type SiteForgeEditorAttachment = Tables<'siteforge_edit_attachments'>

export type SiteForgeEditorAttachmentPreview = Pick<
  SiteForgeEditorAttachment,
  | 'id'
  | 'user_message_id'
  | 'artifact_id'
  | 'artifact_content_hash'
  | 'page_slug'
  | 'viewport'
  | 'mime_type'
  | 'file_size_bytes'
  | 'original_filename'
  | 'width'
  | 'height'
  | 'created_at'
> & {
  signedUrl: string
}

export function siteForgeEditorAttachmentSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function siteForgeEditorAttachmentExtension(mimeType: string): string {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  return 'jpg'
}

export async function listEditorAttachmentPreviews(
  sessionId: string,
  client: SupabaseClient<Database>
): Promise<SiteForgeEditorAttachmentPreview[]> {
  const { data, error } = await client
    .from('siteforge_edit_attachments')
    .select(
      'id, user_message_id, artifact_id, artifact_content_hash, page_slug, viewport, storage_bucket, storage_path, mime_type, file_size_bytes, original_filename, width, height, created_at'
    )
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) {
    throw new Error(`Failed to load editor attachments: ${error.message}`)
  }

  return Promise.all(
    (data || []).map(async attachment => {
      const { data: signed, error: signedError } = await client.storage
        .from(attachment.storage_bucket)
        .createSignedUrl(attachment.storage_path, 15 * 60)
      if (signedError || !signed?.signedUrl) {
        throw new Error(
          `Failed to authorize editor attachment preview: ${
            signedError?.message || attachment.id
          }`
        )
      }
      return {
        id: attachment.id,
        user_message_id: attachment.user_message_id,
        artifact_id: attachment.artifact_id,
        artifact_content_hash: attachment.artifact_content_hash,
        page_slug: attachment.page_slug,
        viewport: attachment.viewport,
        mime_type: attachment.mime_type,
        file_size_bytes: attachment.file_size_bytes,
        original_filename: attachment.original_filename,
        width: attachment.width,
        height: attachment.height,
        created_at: attachment.created_at,
        signedUrl: signed.signedUrl,
      }
    })
  )
}

export async function loadEditorAttachmentBytes(
  attachments: readonly SiteForgeEditorAttachment[],
  client: SupabaseClient<Database>
): Promise<
  Array<{
    attachment: SiteForgeEditorAttachment
    bytes: Uint8Array
  }>
> {
  return Promise.all(
    attachments.map(async attachment => {
      const { data, error } = await client.storage
        .from(attachment.storage_bucket)
        .download(attachment.storage_path)
      if (error || !data) {
        throw new Error(
          `Private editor screenshot is unavailable: ${
            error?.message || attachment.id
          }`
        )
      }
      const bytes = new Uint8Array(await data.arrayBuffer())
      if (
        bytes.byteLength !== attachment.file_size_bytes ||
        siteForgeEditorAttachmentSha256(bytes) !== attachment.byte_sha256
      ) {
        throw new Error(
          `Private editor screenshot failed integrity verification: ${attachment.id}`
        )
      }
      return { attachment, bytes }
    })
  )
}
