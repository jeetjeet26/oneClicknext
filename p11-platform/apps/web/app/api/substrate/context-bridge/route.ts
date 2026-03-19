import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { buildBusinessContextBridge } from '@/utils/substrate/business-context-bridge'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const propertyId = new URL(request.url).searchParams.get('propertyId')
    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const contextBridge = await buildBusinessContextBridge(createServiceClient(), propertyId)
    return NextResponse.json({ context: contextBridge })
  } catch (error) {
    console.error('Substrate context bridge error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

