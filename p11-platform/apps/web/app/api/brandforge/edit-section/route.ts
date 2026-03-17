import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

type DraftSection = {
  step: number
  name: string
  data: Record<string, unknown>
  version?: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asDraftSection(value: unknown): DraftSection | null {
  const record = asRecord(value)
  if (!record) return null
  if (typeof record.step !== 'number' || typeof record.name !== 'string') return null
  const data = asRecord(record.data) ?? {}
  const version = typeof record.version === 'number' ? record.version : undefined
  return {
    step: record.step,
    name: record.name,
    data,
    version,
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { brandAssetId, updates } = await req.json()
    const updatesRecord = asRecord(updates) ?? {}

    if (!brandAssetId || !updates) {
      return NextResponse.json({ error: 'brandAssetId and updates required' }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()

    const { data: brandRaw } = await supabaseAdmin
      .from('property_brand_assets')
      .select('*')
      .eq('id', brandAssetId)
      .single()

    const brand = asRecord(brandRaw)
    const propertyId = typeof brand?.property_id === 'string' ? brand.property_id : null
    const draftSection = asDraftSection(brand?.draft_section)

    if (!brand || !propertyId || !draftSection) {
      return NextResponse.json({ error: 'No draft section to edit' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Merge updates into existing data
    const updatedData = {
      ...draftSection.data,
      ...updatesRecord
    }

    // Update draft section
    const updatePayload: Record<string, unknown> = {
      draft_section: {
        ...draftSection,
        data: updatedData,
        version: (draftSection.version || 1) + 1,
        manually_edited: true,
        edited_at: new Date().toISOString()
      }
    }

    await supabaseAdmin
      .from('property_brand_assets')
      .update(updatePayload as never)
      .eq('id', brandAssetId)

    return NextResponse.json({
      success: true,
      step: draftSection.step,
      sectionName: draftSection.name,
      data: updatedData,
      version: (draftSection.version || 1) + 1
    })

  } catch (error) {
    console.error('Edit Section Error:', error)
    return NextResponse.json({ 
      error: 'Edit failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}



