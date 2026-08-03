import {
  failCanonicalWordPressPreview,
  renderCanonicalWordPressPreview,
  type SiteForgePreviewWorkflowInput,
} from '@/utils/siteforge/workflows/preview-steps'

export function canonicalPreviewErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message
  }
  return 'Canonical WordPress preview failed'
}

export async function siteForgeCanonicalPreviewWorkflow(
  input: SiteForgePreviewWorkflowInput
) {
  'use workflow'
  try {
    return await renderCanonicalWordPressPreview(input)
  } catch (error) {
    await failCanonicalWordPressPreview(
      input,
      canonicalPreviewErrorMessage(error)
    )
    throw error
  }
}
