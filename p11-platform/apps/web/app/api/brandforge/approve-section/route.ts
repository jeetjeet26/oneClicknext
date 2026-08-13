import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  brandContractToStorageSections,
  hashBrandForgeContract,
  normalizeBrandAssetRow,
} from '@/utils/brandforge/normalize'

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

    const approvedAt = new Date().toISOString()
    const approvedData = {
      ...draftSection.data,
      status: 'approved',
      version: draftSection.version || 1,
      approved_at: approvedAt,
      approved_by: user.id
    }

    const isComplete = currentStep === 12
    const prospectiveBrand = {
      ...brand,
      [sectionColumn]: approvedData,
      generation_status: isComplete ? 'complete' : 'generating',
      approval_status: isComplete ? 'approved' : 'reviewing',
      approved_by: isComplete ? user.id : brand.approved_by,
      approved_at: isComplete ? approvedAt : brand.approved_at,
    }
    let normalized = normalizeBrandAssetRow(prospectiveBrand)
    if (currentStep === 6 && access.orgId) {
      const roleMap = {
        primary: 'primary_logo',
        secondary: 'secondary_logo',
        monochrome: 'monochrome_logo',
        mark: 'brand_mark',
        favicon: 'favicon',
      } as const
      const variants = await Promise.all(
        normalized.logos.variants.map(async variant => {
          if (variant.assetId || !variant.url) return variant
          const response = await fetch(variant.url, {
            signal: AbortSignal.timeout(20_000),
          })
          if (!response.ok) {
            throw new Error(`Approved logo could not be snapshotted (${response.status})`)
          }
          const bytes = new Uint8Array(await response.arrayBuffer())
          const contentHash = createHash('sha256').update(bytes).digest('hex')
          const { data: existing } = await supabaseAdmin
            .from('content_assets')
            .select('id')
            .eq('property_id', propertyId)
            .eq('content_hash', contentHash)
            .maybeSingle()
          if (existing) return { ...variant, assetId: existing.id }
          const { data: created, error: assetError } = await supabaseAdmin
            .from('content_assets')
            .insert({
              org_id: access.orgId,
              property_id: propertyId,
              name: `${normalized.identity.name || 'Property'} ${variant.role} logo`,
              asset_type: 'image',
              asset_role: roleMap[variant.role],
              file_url: variant.url,
              file_size_bytes: bytes.byteLength,
              format: response.headers.get('content-type') || 'application/octet-stream',
              content_hash: contentHash,
              source_identity: `brandforge:${brandAssetId}:${variant.role}`,
              source_metadata: { brandAssetId },
              rights_status: 'generated',
              approval_status: 'approved',
              curation_status: 'approved',
              approved_by: user.id,
              approved_at: approvedAt,
              alt_text: variant.alt,
            })
            .select('id')
            .single()
          if (assetError || !created) {
            throw new Error(`Approved logo could not be governed: ${assetError?.message}`)
          }
          return { ...variant, assetId: created.id }
        }),
      )
      normalized = {
        ...normalized,
        logos: { ...normalized.logos, variants },
      }
    }
    const storageSections = brandContractToStorageSections(normalized)

    const updates: Record<string, unknown> = {
      [sectionColumn]: storageSections[
        sectionColumn as keyof typeof storageSections
      ],
      current_step: currentStep + 1,
      draft_section: null,
      contract_version: normalized.contractVersion,
      brand_origin: normalized.origin,
      approval_status: isComplete ? 'approved' : 'reviewing',
      contract_hash: hashBrandForgeContract(normalized),
    }

    if (isComplete) {
      updates.generation_status = 'complete'
      updates.current_step = 12 // Stay at 12
      updates.approved_by = user.id
      updates.approved_at = approvedAt
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
      isComplete,
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



