import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '')

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

    const { brandAssetId, hint } = await req.json()

    if (!brandAssetId) {
      return NextResponse.json({ error: 'brandAssetId required' }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()

    const { data: brandRaw } = await supabaseAdmin
      .from('property_brand_assets')
      .select('*')
      .eq('id', brandAssetId)
      .single()

    const brandRecord = asRecord(brandRaw)
    const draftSection = asDraftSection(brandRecord?.draft_section)
    const propertyId = typeof brandRecord?.property_id === 'string' ? brandRecord.property_id : null

    if (!brandRaw || !draftSection || !propertyId) {
      return NextResponse.json({ error: 'No draft section to regenerate' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const currentData = draftSection.data

    // Build regeneration prompt
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' })
    
    const regenerationPrompt = `
You previously generated this ${draftSection.name} section:
${JSON.stringify(currentData, null, 2)}

${hint ? `User feedback: "${hint}"` : 'Generate a new, different version.'}

Context:
${JSON.stringify(brandRaw.conversation_summary)}

Approved sections:
${JSON.stringify({
  introduction: brandRaw.section_1_introduction,
  positioning: brandRaw.section_2_positioning,
  targetAudience: brandRaw.section_3_target_audience,
  personas: brandRaw.section_4_personas,
  nameStory: brandRaw.section_5_name_story
})}

Generate a NEW version for the ${draftSection.name} section. Make it distinct from the previous version.
Output ONLY valid JSON matching the same structure.
`

    const result = await model.generateContent(regenerationPrompt)
    const responseText = result.response.text()
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Failed to extract JSON from regeneration')
    }

    const regeneratedData = JSON.parse(jsonMatch[0])

    // Update draft section with new version
    const updatePayload: Record<string, unknown> = {
      draft_section: {
        ...draftSection,
        data: regeneratedData,
        version: (draftSection.version || 1) + 1,
        regenerated_at: new Date().toISOString()
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
      data: regeneratedData,
      version: (draftSection.version || 1) + 1
    })

  } catch (error) {
    console.error('Regenerate Section Error:', error)
    return NextResponse.json({ 
      error: 'Regeneration failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}



