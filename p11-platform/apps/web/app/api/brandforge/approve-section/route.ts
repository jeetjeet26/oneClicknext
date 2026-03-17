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

    const { brandAssetId } = await req.json()

    if (!brandAssetId) {
      return NextResponse.json({ error: 'brandAssetId required' }, { status: 400 })
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
      return NextResponse.json({ error: 'No draft section to approve' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const currentStep = draftSection.step

    // Determine column name for this section
    const sectionColumn = `section_${currentStep}_${draftSection.name}`

    // Prepare approved data
    const approvedData = {
      ...draftSection.data,
      status: 'approved',
      version: draftSection.version || 1,
      approved_at: new Date().toISOString(),
      approved_by: user.id
    }

    // Update: move draft to approved, increment step, clear draft
    const updates: Record<string, unknown> = {
      [sectionColumn]: approvedData,
      current_step: currentStep + 1,
      draft_section: null
    }

    // If this was the last section (12), mark as complete
    if (currentStep === 12) {
      updates.generation_status = 'complete'
      updates.current_step = 12 // Stay at 12
    } else {
      updates.generation_status = 'generating'
      updates.current_step_name = getStepName(currentStep + 1)
    }

    await supabaseAdmin
      .from('property_brand_assets')
      .update(updates as never)
      .eq('id', brandAssetId)

    return NextResponse.json({
      success: true,
      approvedStep: currentStep,
      nextStep: currentStep === 12 ? null : currentStep + 1,
      isComplete: currentStep === 12,
      progress: `${currentStep}/12`
    })

  } catch (error) {
    console.error('Approve Section Error:', error)
    return NextResponse.json({ 
      error: 'Approval failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}

function getStepName(step: number): string {
  const names: Record<number, string> = {
    1: 'introduction',
    2: 'positioning',
    3: 'target_audience',
    4: 'personas',
    5: 'name_story',
    6: 'logo',
    7: 'typography',
    8: 'colors',
    9: 'design_elements',
    10: 'photo_yep',
    11: 'photo_nope',
    12: 'implementation'
  }
  return names[step] || ''
}



