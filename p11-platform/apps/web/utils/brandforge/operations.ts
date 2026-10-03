import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export const brandId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
export const brandCommandSchema = z.object({ brandAssetId: brandId, requestId: brandId, revision: z.number().int().positive() })
export type BrandKind = 'brief' | 'generate' | 'regenerate' | 'edit' | 'approve' | 'contract' | 'import' | 'export' | 'revise' | 'visuals' | 'publish'
export type BrandRow = Record<string, unknown> & { id: string; property_id: string; revision: number }
type JsonObject = Record<string, unknown>
export const brandHeaders = { 'Cache-Control': 'no-store' }
export async function brandRpc(name: string, args: JsonObject): Promise<JsonObject> {
  const client = createAdminClient() as unknown as { rpc: (name: string, args: JsonObject) => Promise<{ data: unknown; error: unknown }> }
  const { data, error } = await client.rpc(name, args)
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Brand operation could not be confirmed')
  return data as JsonObject
}
export function brandReply(result: JsonObject) {
  const state = result.state
  const messages: Record<string, string> = {
    stale: 'This brand has changed. Reload the saved version before continuing.',
    busy: 'Another brand request is still running. Review its status before trying again.',
    running: 'This request is still running. Reload to check its status.',
    cancelled: 'This request was stopped. Reload before starting another request.',
    failed: 'This request did not finish. Reload the saved version and start a new request.',
    no_draft: 'There is no saved draft to review. Reload the brand.',
    draft_exists: 'A draft is already saved. Reload to review it.',
    brief_closed: 'The brief is already complete. Open the saved brand to review or revise it.',
    approval_required: 'Approve the saved brand before exporting it.',
    request_conflict: 'This request no longer matches the saved request. Reload before continuing.',
  }
  const ok = state === 'applied' || state === 'replayed'
  return NextResponse.json(ok ? result : { ...result, error: messages[String(state)] || 'Brand request could not be completed.' }, {
    status: ok ? 200 : state === 'forbidden' ? 403 : state === 'not_found' ? 404 : 409, headers: brandHeaders,
  })
}
export async function runBrandCommand<T extends z.ZodRawShape>(request: NextRequest, kind: BrandKind, fields: T,
  execute: (context: { body: z.infer<typeof brandCommandSchema> & z.infer<z.ZodObject<T>>; brand: BrandRow; userId: string; orgId: string; client: ReturnType<typeof createAdminClient>; assertActive: () => Promise<void> }) => Promise<{ updates: JsonObject; result: JsonObject }>) {
  let knownFailure = false
  let claim: { requestId: string; token: string } | null = null
  try {
    const auth = await createClient()
    const { data: { user }, error } = await auth.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: brandHeaders })
    const body = brandCommandSchema.extend(fields).strict().safeParse(await request.json().catch(() => null))
    if (!body.success) return NextResponse.json({ error: 'A valid request and saved brand version are required.' }, { status: 400, headers: brandHeaders })
    const command = body.data as z.infer<typeof brandCommandSchema> & z.infer<z.ZodObject<T>>
    const client = createAdminClient()
    const { data, error: readError } = await client.from('property_brand_assets').select('*').eq('id', command.brandAssetId).single()
    if (readError || !data) return NextResponse.json({ error: 'Brand not found' }, { status: 404, headers: brandHeaders })
    const brand = data as unknown as BrandRow
    const access = await validatePropertyAccess(user.id, brand.property_id)
    if (!access.authorized || !access.orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: brandHeaders })
    const input = { ...body.data } as JsonObject
    delete input.requestId; delete input.revision; delete input.brandAssetId
    const started = await brandRpc('begin_brand_operation', { p_property_id: brand.property_id, p_brand_asset_id: brand.id, p_actor_id: user.id, p_request_id: command.requestId, p_revision: command.revision, p_kind: kind, p_input: input })
    if (started.state !== 'claimed') return brandReply(started)
    if (typeof started.claimToken !== 'string') throw new Error('Missing brand claim')
    claim = { requestId: command.requestId, token: started.claimToken }
    const activeClaim = claim
    const assertActive = async () => {
      const current = await brandRpc('check_brand_operation', { p_request_id: activeClaim.requestId, p_claim_token: activeClaim.token })
      if (current.state !== 'active') throw new Error('Brand request is no longer active')
    }
    const output = await execute({ body: command, brand, userId: user.id, orgId: access.orgId, client, assertActive })
    return brandReply(await brandRpc('finish_brand_operation', { p_request_id: claim.requestId, p_claim_token: claim.token, p_updates: output.updates, p_result: output.result }))
  } catch {
    if (claim) {
      try {
        const recovered = await brandRpc('finish_brand_operation', { p_request_id: claim.requestId, p_claim_token: claim.token, p_updates: {}, p_result: {}, p_error: kind === 'export' ? 'export_failed' : ['generate', 'regenerate', 'visuals'].includes(kind) ? 'generation_failed' : 'save_failed' })
        if (recovered.state === 'replayed') return brandReply(recovered)
        knownFailure = recovered.state === 'failed' || recovered.state === 'cancelled'
      } catch { /* An unconfirmed request remains visible for review; never silently repeat provider work. */ }
    }
    return NextResponse.json({ ...(knownFailure ? { state: 'failed' } : {}), error: kind === 'export' ? 'The export could not be confirmed. Reload the saved brand to review the request.' : 'The brand request could not be confirmed. Reload to review the saved version and request status.' }, { status: 503, headers: brandHeaders })
  }
}
export const sectionNames = ['introduction', 'positioning', 'target_audience', 'personas', 'name_story', 'logo', 'typography', 'colors', 'design_elements', 'photo_yep', 'photo_nope', 'implementation'] as const
export function savedDraft(brand: BrandRow) {
  const draft = z.object({ step: z.number().int().min(1).max(12), name: z.string(), data: z.record(z.string(), z.unknown()), version: z.number().int().positive().default(1) }).passthrough().parse(brand.draft_section)
  if (draft.name !== sectionNames[draft.step - 1]) throw new Error('Invalid saved section')
  return draft
}
