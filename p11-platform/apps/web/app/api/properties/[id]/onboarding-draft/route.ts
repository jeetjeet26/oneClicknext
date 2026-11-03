import { NextResponse } from 'next/server'
import { propertyDraftSaveSchema } from '@/utils/property-setup/draft-contracts'
import { propertyIdSchema } from '@/utils/property-setup/contracts'
import { requireSetupActor, PropertySetupError } from '@/utils/property-setup/store'
import { createServiceClient } from '@/utils/supabase/admin'

const headers = { 'Cache-Control': 'private, no-store' }
async function handle(req: Request, context: { params: Promise<{ id: string }> }, write: boolean) {
  try {
    const { id } = await context.params
    if (!propertyIdSchema.safeParse(id).success) return NextResponse.json({ error: 'Choose a saved property.' }, { status: 400, headers })
    const actor = await requireSetupActor(id)
    const input = write ? propertyDraftSaveSchema.safeParse(await req.json().catch(() => null)) : null
    if (input && !input.success) return NextResponse.json({ error: input.error.issues[0]?.message || 'Review the draft.' }, { status: 400, headers })
    const db = createServiceClient()
    const { data: result, error } = await db.rpc('property_onboarding_draft', { p_property_id: id, p_actor_id: actor, p_input: input?.success ? input.data : null })
    const data = result as Record<string, unknown> | null
    if (error || !data) throw new PropertySetupError('The draft could not be confirmed. Keep this page open and retry.')
    if (data.state === 'forbidden') throw new PropertySetupError('Your current access does not allow editing this setup.', 403)
    if (data.state === 'property_changed') throw new PropertySetupError('Property details changed after this draft. Reload the saved setup and review its latest values.', 409)
    if (data.state === 'completed') throw new PropertySetupError('This setup has already completed. Open the property editor.', 409)
    if (!['ready', 'saved'].includes(String(data.state))) throw new PropertySetupError('The saved draft changed. Reload the saved setup before continuing.', 409)
    return NextResponse.json(data, { headers })
  } catch (e) {
    return NextResponse.json({ error: e instanceof PropertySetupError ? e.message : 'The setup draft is unavailable.' }, { status: e instanceof PropertySetupError ? e.status : 503, headers })
  }
}
export const GET = (req: Request, context: { params: Promise<{ id: string }> }) => handle(req, context, false)
export const PUT = (req: Request, context: { params: Promise<{ id: string }> }) => handle(req, context, true)
