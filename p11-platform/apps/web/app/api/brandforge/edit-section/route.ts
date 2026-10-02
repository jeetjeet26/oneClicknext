import { NextRequest } from 'next/server'
import { z } from 'zod'
import { runBrandCommand, savedDraft } from '@/utils/brandforge/operations'

export async function POST(request: NextRequest) {
  return runBrandCommand(request, 'edit', { updates: z.record(z.string(), z.unknown()).refine(value => JSON.stringify(value).length <= 131072) }, async ({ body, brand }) => {
    const draft = savedDraft(brand)
    const data = { ...draft.data, ...body.updates }
    // Review metadata is server-owned, even when the content editor accepts structured sections.
    delete data.status; delete data.approved_by; delete data.approved_at; delete data._meta
    if (draft.data._meta && typeof draft.data._meta === 'object' && !Array.isArray(draft.data._meta)) data._meta = { ...draft.data._meta, approval: { status: 'reviewing' } }
    const version = draft.version + 1
    return { updates: { draft_section: { ...draft, data, version, manually_edited: true, edited_at: new Date().toISOString() } }, result: { step: draft.step, sectionName: draft.name, data, version } }
  })
}
