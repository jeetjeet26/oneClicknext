import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { syncPropertyUnitsToKnowledgeBase } from '@/utils/property-units-kb-sync'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const access = await validatePropertyAccess(user.id, id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    
    const { data: units, error } = await supabase
      .from('property_units')
      .select('*')
      .eq('property_id', id)
      .order('bedrooms', { ascending: true })
      .order('unit_type', { ascending: true })
    
    if (error) throw error
    
    // Auto-sync units to knowledge base if units exist but no pricing document
    if (units && units.length > 0) {
      const adminClient = createAdminClient()
      
      // Check if pricing document exists
      const { data: pricingDoc } = await adminClient
        .from('documents')
        .select('id')
        .eq('property_id', id)
        .eq('metadata->>category', 'pricing')
        .eq('metadata->>source', 'property_units')
        .single()
      
      // If no pricing document, sync units to KB
      if (!pricingDoc) {
        const syncResult = await syncPropertyUnitsToKnowledgeBase(id)
        if (!syncResult.success) {
          console.warn('Auto-sync to KB failed:', syncResult.error)
        }
      }
    }
    
    return NextResponse.json({ units: units || [] })
    
  } catch (error: unknown) {
    console.error('Error fetching property units:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch property units' },
      { status: 500 }
    )
  }
}

