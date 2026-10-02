import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import {
  brandContractToStorageSections,
  hashBrandForgeContract,
  normalizeBrandAssetRow,
} from '@/utils/brandforge/normalize'

import { runBrandCommand, savedDraft, sectionNames } from '@/utils/brandforge/operations'

export async function POST(request: NextRequest) {
 return runBrandCommand(request, 'approve', {}, async ({ body: { brandAssetId }, brand, userId, orgId, client: supabaseAdmin }) => {
 const propertyId = brand.property_id
 const draftSection = savedDraft(brand)
    const currentStep = draftSection.step

    // Determine column name for this section
    const sectionColumn = `section_${currentStep}_${draftSection.name}`

    const approvedAt = new Date().toISOString()
    const approvedData = {
      ...draftSection.data,
      _meta: { ...(draftSection.data._meta as Record<string, unknown> || {}), approval: { status: 'approved', approvedBy: userId, approvedAt } },
      status: 'approved',
      version: draftSection.version || 1,
      approved_at: approvedAt,
      approved_by: userId
    }

    const isComplete = currentStep === 12
    const prospectiveBrand = {
      ...brand,
      [sectionColumn]: approvedData,
      generation_status: isComplete ? 'complete' : 'generating',
      approval_status: isComplete ? 'approved' : 'reviewing',
      approved_by: isComplete ? userId : brand.approved_by,
      approved_at: isComplete ? approvedAt : brand.approved_at,
    }
    let normalized = normalizeBrandAssetRow(prospectiveBrand)
    if (currentStep === 6 && orgId) {
      const roleMap = {
        primary: 'primary_logo',
        secondary: 'secondary_logo',
        monochrome: 'monochrome_logo',
        mark: 'brand_mark',
        favicon: 'favicon',
      } as const
      const variants = await Promise.all(
        normalized.logos.variants.map(async variant => {
          if (variant.assetId) {
            const { data: asset, error } = await supabaseAdmin.from('content_assets').select('file_url,approval_status,rights_status,expires_at,duplicate_of').eq('id', variant.assetId).eq('property_id', propertyId).single()
            if (error || !asset || asset.approval_status !== 'approved' || !['owned','licensed','generated'].includes(asset.rights_status || '') || asset.duplicate_of || (asset.expires_at && new Date(asset.expires_at) <= new Date()) || asset.file_url !== variant.url) throw new Error('The selected logo needs asset review')
            return variant
          }
          if (!variant.url) return variant
          const url = new URL(variant.url)
          const storage = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '')
          if (url.origin !== storage.origin || !url.pathname.startsWith('/storage/v1/object/public/brand-assets/')) throw new Error('Upload the approved logo to the brand asset library first')
          const response = await fetch(url, { redirect: 'error',
            signal: AbortSignal.timeout(20_000),
          })
          if (!response.ok) {
            throw new Error(`Approved logo could not be snapshotted (${response.status})`)
          }
          if (Number(response.headers.get('content-length')) > 10_000_000) throw new Error('Logo is too large')
          const bytes = new Uint8Array(await response.arrayBuffer())
          if (bytes.byteLength > 10_000_000) throw new Error('Logo is too large')
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
              org_id: orgId,
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
              approved_by: userId,
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
      updates.approved_by = userId
      updates.approved_at = approvedAt
    } else {
      updates.generation_status = 'generating'
      updates.current_step_name = sectionNames[currentStep]
    }

    return { updates, result: { approvedStep: currentStep, nextStep: isComplete ? null : currentStep + 1, isComplete, progress: `${currentStep}/12` } }
 })
}
