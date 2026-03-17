import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { syncPropertyUnitsToKnowledgeBase } from '@/utils/property-units-kb-sync'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { propertyId } = await req.json()
    
    if (!propertyId) {
      return NextResponse.json({ error: 'Property ID required' }, { status: 400 })
    }
    
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    
    // Sync units to knowledge base
    const result = await syncPropertyUnitsToKnowledgeBase(propertyId)
    
    if (!result.success) {
      return NextResponse.json({ 
        error: result.error || 'Failed to sync units' 
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      document_id: result.document_id,
      message: 'Property units synced to knowledge base'
    })
    
  } catch (error: unknown) {
    console.error('Sync units to KB error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync units' },
      { status: 500 }
    )
  }
}

