import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { brandHeaders, brandId, brandRpc, brandReply } from '@/utils/brandforge/operations'

export async function GET(request: NextRequest) {
 try {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: brandHeaders })
  const id = brandId.safeParse(request.nextUrl.searchParams.get('brandAssetId'))
  if (!id.success) return NextResponse.json({ error: 'Brand ID required' }, { status: 400, headers: brandHeaders })
  const admin = createAdminClient()
  const { data: brand, error: readError } = await admin.from('property_brand_assets').select('*').eq('id', id.data).single()
  if (readError || !brand?.property_id) return NextResponse.json({ error: 'Brand not found' }, { status: 404, headers: brandHeaders })
  const access = await validatePropertyAccess(user.id, brand.property_id)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: brandHeaders })
  // Private tables remain restricted to the server by database grants.
  const { data: operations, error: operationError } = await admin.from('brand_operations').select('id,kind,state,started_at,finished_at').eq('brand_asset_id', brand.id).order('started_at', { ascending: false }).limit(20)
  if (operationError) throw operationError
  const saved = brand as unknown as Record<string, unknown>
  return NextResponse.json({ brandAssetId: brand.id, propertyId: brand.property_id, revision: saved.revision, generationStatus: brand.generation_status, conversationHistory: Array.isArray(brand.gemini_conversation_history) ? brand.gemini_conversation_history.filter(message => message && typeof message === 'object' && !Array.isArray(message) && ['user','assistant'].includes(String(message.role)) && typeof message.content === 'string').map(message => { const item = message as {role:string;content:string}; return {role:item.role,content:item.content} }) : [], currentStep: brand.current_step, draft: brand.draft_section, approvalStatus: brand.approval_status, isComplete: brand.approval_status === 'approved', pdfUrl: brand.brand_book_pdf_url, operations }, { headers: brandHeaders })
 } catch {
  return NextResponse.json({ error: 'Saved brand could not be loaded. Try again.' }, { status: 503, headers: brandHeaders })
 }
}
export async function POST(request: NextRequest) {
 try {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: brandHeaders })
  const body = z.object({ propertyId: brandId, requestId: brandId, decisionId: brandId }).strict().safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: brandHeaders })
  const access = await validatePropertyAccess(user.id, body.data.propertyId)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: brandHeaders })
  const result = await brandRpc('cancel_brand_operation', { p_property_id: body.data.propertyId, p_request_id: body.data.requestId, p_actor_id: user.id, p_decision_id: body.data.decisionId })
  return result.state === 'cancelled' ? NextResponse.json(result, { headers: brandHeaders }) : brandReply(result)
 } catch { return NextResponse.json({ error: 'The request could not be stopped. Reload to check its status.' }, { status: 503, headers: brandHeaders }) }
}
