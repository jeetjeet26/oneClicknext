import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { editPropertyChatbotContext } from '@/utils/services/chatbot-context-editor'

export async function GET(req: NextRequest) {
  const supabaseAuth = await createClient()
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const propertyId = req.nextUrl.searchParams.get('propertyId')
  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
  }

  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const [{ data: context }, { data: revisions }] = await Promise.all([
    supabase
      .from('property_chatbot_contexts')
      .select('*')
      .eq('property_id', propertyId)
      .maybeSingle(),
    supabase
      .from('property_chatbot_context_revisions')
      .select('id, change_summary, changed_source_ids, removed_source_ids, model, created_at')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  return NextResponse.json({
    context,
    revisions: revisions ?? [],
  })
}

export async function POST(req: NextRequest) {
  const supabaseAuth = await createClient()
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const propertyId = typeof body.propertyId === 'string' ? body.propertyId : null
  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
  }

  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const result = await editPropertyChatbotContext(supabase, propertyId, {
    changeSummary: 'Manual chatbot context regeneration requested.',
    mode: 'regenerate',
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? 'Failed to regenerate chatbot context' }, { status: 500 })
  }

  return NextResponse.json({ success: true, status: result.status })
}
