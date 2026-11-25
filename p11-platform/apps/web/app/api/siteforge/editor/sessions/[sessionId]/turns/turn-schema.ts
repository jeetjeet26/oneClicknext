import { z } from 'zod'
import { siteForgeEditorScopeSchema } from '@/utils/siteforge/editor/scope'
import { siteForgeEditorAttachmentIdsSchema } from '@/utils/siteforge/editor/attachments'
import { siteForgePageManagerActionSchema } from '@/utils/siteforge/editor/page-manager'

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
