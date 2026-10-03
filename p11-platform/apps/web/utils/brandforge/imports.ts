import { createHash } from 'node:crypto'
import { brandRpc } from './operations'
import { createServiceClient } from '@/utils/supabase/admin'
import { isSafePublicHttpUrl } from '@/utils/services/url-safety'
import {
  brandContractToStorageSections,
  hashBrandForgeContract,
  normalizeBrandForgeContract,
} from './normalize'
import type { BrandForgeContractV1 } from './contracts'
import type { Json } from '@/types/supabase'

type JsonRecord = Record<string, unknown>

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}

export type BrandImportInput = {
  orgId: string
  propertyId: string
  userId: string
  sourceType: 'package' | 'website' | 'manual' | 'hybrid'
  idempotencyKey: string
  websiteUrl?: string
  documentIds?: string[]
  sourceIds?: string[]
  manual?: JsonRecord
}

type BrandConflict = {
  field: string
  candidates: Array<{ value: unknown; source: string }>
  resolution?: unknown
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function extractWebsiteCandidates(html: string, sourceUrl: string): JsonRecord {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || ''
  const logoUrls = [...html.matchAll(/<img[^>]+(?:class|id)=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/gi)]
    .map(match => {
      try {
        return new URL(match[1], sourceUrl).toString()
      } catch {
        return ''
      }
    })
    .filter(Boolean)
  const colors = unique(
    [...html.matchAll(/#[0-9a-f]{6}\b/gi)].map(match => match[0].toUpperCase()),
  ).slice(0, 12)
  const fonts = unique(
    [...html.matchAll(/font-family\s*:\s*([^;}]+)/gi)]
      .map(match => match[1].split(',')[0].replace(/["']/g, '').trim()),
  ).slice(0, 8)
  const metaDescription = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  )?.[1]?.trim() || ''

  return {
    identity: { name: title, story: metaDescription },
    logos: {
      variants: logoUrls.map((url, index) => ({
        role: index === 0 ? 'primary' : 'secondary',
        url,
        alt: title ? `${title} logo` : 'Property logo',
        restrictions: [],
      })),
    },
    typography: {
      roles: fonts.map((family, index) => ({
        role: index === 0 ? 'headline' : index === 1 ? 'body' : 'accent',
        family,
        weights: [400],
        usage: index === 0 ? 'Headlines' : 'Body copy',
      })),
    },
    colors: {
      roles: colors.map((hex, index) => ({
        role: index === 0 ? 'primary' : index === 1 ? 'secondary' : 'accent',
        name: `Website color ${index + 1}`,
        hex,
        usage: 'Extracted from existing website CSS',
      })),
    },
  }
}

async function fetchWebsite(url: string): Promise<string> {
  if (!isSafePublicHttpUrl(url)) {
    throw new Error('Website URL must be a public HTTP(S) URL')
  }
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'P11-BrandForge-Importer/1.0' },
  })
  if (!response.ok) throw new Error(`Website returned ${response.status}`)
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/html')) throw new Error('Website did not return HTML')
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > 2_000_000) throw new Error('Website response is too large')
  if (!response.body) throw new Error('Website did not return content')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2_000_000) throw new Error('Website response is too large')
      chunks.push(value)
    }
  } finally { await reader.cancel(); reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}

function findConflicts(sourceCandidates: Array<{ source: string; value: JsonRecord }>): BrandConflict[] {
  const conflicts: BrandConflict[] = []
  for (const field of ['identity', 'logos', 'typography', 'colors']) {
    const candidates = sourceCandidates
      .map(candidate => ({ source: candidate.source, value: candidate.value[field] }))
      .filter(candidate => candidate.value != null)
    const distinct = new Set(candidates.map(candidate => JSON.stringify(candidate.value)))
    if (distinct.size > 1) conflicts.push({ field, candidates })
  }
  return conflicts
}

export async function createBrandImportPreview(input: BrandImportInput) {
  const client = createServiceClient()
  const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  const { data: prior, error: priorError } = await client.from('property_brand_imports').select('*').eq('property_id', input.propertyId).eq('idempotency_key', input.idempotencyKey).maybeSingle()
  if (priorError) throw new Error('Brand preview could not be loaded')
  if (prior) {
    if (prior.created_by !== input.userId || record(prior.extraction_report).inputHash !== inputHash) throw new Error('This preview request changed. Start a new preview.')
    return prior
  }
  const { data: currentBrand, error: brandReadError } = await client.from('property_brand_assets').select('*').eq('property_id', input.propertyId).maybeSingle()
  if (brandReadError) throw new Error('Saved brand could not be loaded')
  const baseRevision = currentBrand ? Number(record(currentBrand).revision) : 0
  const candidates: Array<{ source: string; value: JsonRecord }> = []
  const sourceManifest: JsonRecord[] = []

  if (input.documentIds?.length) {
    const { data: documents, error } = await client
      .from('documents')
      .select('id, content, metadata, original_file_name')
      .eq('property_id', input.propertyId)
      .in('id', input.documentIds)
    if (error || new Set(documents?.map(document => document.id)).size !== new Set(input.documentIds).size) throw new Error('Every brand document must belong to this property and still be available.')
    const combined = (documents || []).map(document => document.content).join('\n\n')
    const colors = unique(
      [...combined.matchAll(/#[0-9a-f]{6}\b/gi)].map(match => match[0].toUpperCase()),
    )
    candidates.push({
      source: 'package',
      value: {
        introduction: { content: combined.slice(0, 5_000) },
        colors: {
          roles: colors.slice(0, 12).map((color, index) => ({
            role: index === 0 ? 'primary' : index === 1 ? 'secondary' : 'accent',
            name: `Package color ${index + 1}`,
            hex: color,
            usage: 'Extracted from uploaded brand package',
          })),
        },
      },
    })
    sourceManifest.push(...(documents || []).map(document => ({
      sourceType: 'document',
      sourceId: document.id,
      identity: document.original_file_name || 'brand-package',
    })))
  }

  if (input.sourceIds?.length) {
    // This private table is intentionally unavailable to browser clients and retrieval.
    const { data: sources, error } = await client.from('brand_import_sources').select('*').eq('property_id', input.propertyId).in('id', input.sourceIds)
    const rows = (sources || []) as unknown as Array<{ id: string; name: string; content: string; content_hash: string }>
    if (error || new Set(rows.map(source => source.id)).size !== new Set(input.sourceIds).size) throw new Error('Every brand source must belong to this property and still be available.')
    const combined = rows.map(source => source.content).join('\n\n')
    const colors = unique([...combined.matchAll(/#[0-9a-f]{6}\b/gi)].map(match => match[0].toUpperCase())).slice(0, 12)
    candidates.push({ source: 'package', value: { introduction: { content: combined.slice(0, 5000) }, colors: { roles: colors.map((hex, index) => ({ role: index === 0 ? 'primary' : index === 1 ? 'secondary' : 'accent', name: `Package color ${index + 1}`, hex, usage: 'Extracted from uploaded brand package' })) } } })
    sourceManifest.push(...rows.map(source => ({ sourceType: 'brand_import_source', sourceId: source.id, identity: source.name, contentHash: source.content_hash })))
  }

  if (input.websiteUrl) {
    const html = await fetchWebsite(input.websiteUrl)
    candidates.push({
      source: 'website',
      value: extractWebsiteCandidates(html, input.websiteUrl),
    })
    sourceManifest.push({
      sourceType: 'website',
      sourceUrl: input.websiteUrl,
      capturedAt: new Date().toISOString(),
    })
  }

  if (input.manual && Object.keys(input.manual).length) {
    candidates.push({ source: 'manual', value: input.manual })
    sourceManifest.push({
      sourceType: 'manual',
      sourceId: input.userId,
      capturedAt: new Date().toISOString(),
    })
  }

  if (!candidates.length) throw new Error('At least one import source is required')

  const merged = candidates.reduce<JsonRecord>((result, candidate) => ({
    ...result,
    ...candidate.value,
  }), {})
  const conflicts = findConflicts(candidates)
  const contract = normalizeBrandForgeContract(merged, {
    origin: candidates.length > 1 ? 'hybrid' : 'imported',
    approvalStatus: 'reviewing',
    confidence: conflicts.length ? 0.6 : 0.85,
  })
  const contentHash = hashBrandForgeContract(contract)

  const saved = await brandRpc('save_brand_import_preview', {
    p_property_id: input.propertyId, p_actor_id: input.userId, p_idempotency_key: input.idempotencyKey,
    p_input_hash: inputHash, p_base_revision: baseRevision,
    p_payload: {
      source_type: input.sourceType, source_identity: input.websiteUrl || input.sourceIds?.join(',') || input.documentIds?.join(',') || 'manual',
      source_manifest: sourceManifest, extracted_contract: contract, conflicts,
      extraction_report: { sourceCount: candidates.length, requiresHumanApproval: true }, content_hash: contentHash,
    },
  })
  if (!['applied', 'replayed'].includes(String(saved.state))) throw new Error(saved.state === 'stale' ? 'The saved brand changed while this preview was prepared. Reload and prepare a new preview.' : 'This preview could not be saved. Reload to review the current request.')
  return saved.preview as NonNullable<typeof prior>

}

export async function confirmBrandImport(input: {
  importId: string
  propertyId: string
  userId: string
  requestId: string
  contract?: JsonRecord
  resolutions?: Record<string, unknown>
}): Promise<{ brandAssetId: string; contract: BrandForgeContractV1; contractHash: string }> {
  const client = createServiceClient()
  const { data: importRow, error } = await client
    .from('property_brand_imports')
    .select('*')
    .eq('id', input.importId)
    .eq('property_id', input.propertyId)
    .single()
  if (error || !importRow) throw new Error('Brand import not found')
  const report = record(importRow.extraction_report)
  if (!Number.isInteger(report.baseRevision)) throw new Error('Create a new preview before approving this brand')

  const conflicts = Array.isArray(importRow.conflicts) ? importRow.conflicts : []
  const unresolved = conflicts.filter(conflict => {
    const field = typeof conflict === 'object' && conflict && 'field' in conflict
      ? String(conflict.field)
      : ''
    return field && !(field in (input.resolutions || {}))
  })
  if (unresolved.length) {
    throw new Error(`Resolve import conflicts before approval: ${unresolved.map(item => record(item).field).join(', ')}`)
  }

  const extracted = record(importRow.extracted_contract)
  const corrected = {
    ...extracted,
    ...(input.contract || {}),
    ...Object.fromEntries(Object.entries(input.resolutions || {}).filter(([key]) => ['identity','logos','typography','colors'].includes(key))),
  }
  const approvedAt = new Date().toISOString()
  const approvedContent = Object.fromEntries(Object.entries(corrected).map(([key, value]) => {
    const section = record(value)
    return [key, value && typeof value === 'object' && !Array.isArray(value) ? { ...section, _meta: { ...record(section._meta), approval: { status: 'approved', approvedBy: input.userId, approvedAt } } } : value]
  }))
  const contract = normalizeBrandForgeContract(approvedContent, {
    origin: importRow.source_type === 'hybrid' ? 'hybrid' : 'imported',
    approvalStatus: 'approved',
    approvedBy: input.userId,
    approvedAt,
    confidence: 1,
  })
  const contractHash = hashBrandForgeContract(contract)
  const sections = brandContractToStorageSections(contract)

  const unresolvedLogoSources = contract.logos.variants.filter(variant => !variant.assetId)
  if (unresolvedLogoSources.length) {
    throw new Error(
      'Imported logo candidates must be uploaded, rights-cleared, and selected from the content asset library before approval',
    )
  }
  const referencedAssetIds = [
    ...contract.logos.variants.flatMap(variant => variant.assetId ? [variant.assetId] : []),
    ...contract.typography.roles.flatMap(role => role.assetId ? [role.assetId] : []),
    ...contract.photographyYes.exampleAssetIds,
  ]
  if (referencedAssetIds.length) {
    const { data: assets, error: assetError } = await client
      .from('content_assets')
      .select('id, approval_status, rights_status, expires_at, duplicate_of')
      .eq('property_id', input.propertyId)
      .in('id', referencedAssetIds)
    if (assetError) throw new Error(`Failed to validate brand assets: ${assetError.message}`)
    const approvedIds = new Set(
      (assets || [])
        .filter(asset =>
          asset.approval_status === 'approved'
          && ['owned', 'licensed', 'generated'].includes(asset.rights_status)
          && (!asset.expires_at || new Date(asset.expires_at) > new Date())
          && !asset.duplicate_of
        )
        .map(asset => asset.id),
    )
    const blocked = referencedAssetIds.filter(id => !approvedIds.has(id))
    if (blocked.length) throw new Error(`Brand references unapproved or rights-blocked assets: ${blocked.join(', ')}`)

  }

  const brandInsert = {
      generation_status: 'complete',
      current_step: 12,
      current_step_name: 'implementation',
      draft_section: null,
      contract_version: contract.contractVersion,
      brand_origin: contract.origin,
      approval_status: 'approved',
      contract_hash: contractHash,
      source_manifest: toJson(importRow.source_manifest),
      approved_by: input.userId,
      approved_at: approvedAt,
      section_1_introduction: toJson(sections.section_1_introduction),
      section_2_positioning: toJson(sections.section_2_positioning),
      section_3_target_audience: toJson(sections.section_3_target_audience),
      section_4_personas: toJson(sections.section_4_personas),
      section_5_name_story: toJson(sections.section_5_name_story),
      section_6_logo: toJson(sections.section_6_logo),
      section_7_typography: toJson(sections.section_7_typography),
      section_8_colors: toJson(sections.section_8_colors),
      section_9_design_elements: toJson(sections.section_9_design_elements),
      section_10_photo_yep: toJson(sections.section_10_photo_yep),
      section_11_photo_nope: toJson(sections.section_11_photo_nope),
      section_12_implementation: toJson(sections.section_12_implementation),
    }
  const claim = await brandRpc('begin_brand_operation', { p_property_id: input.propertyId, p_brand_asset_id: report.brandAssetId || null, p_actor_id: input.userId, p_request_id: input.requestId, p_revision: report.baseRevision, p_kind: 'import', p_input: { importId: input.importId, contract: input.contract || null, resolutions: input.resolutions || null } })
  if (claim.state === 'replayed') return { brandAssetId: String(claim.brandAssetId), contract: claim.contract as BrandForgeContractV1, contractHash: String(claim.contractHash) }
  if (claim.state !== 'claimed') throw new Error(claim.state === 'stale' ? 'The saved brand changed. Create a new preview before approval.' : 'This brand request needs review before approval. Reload the saved brand.')
  try {
    const result = await brandRpc('finish_brand_operation', {
      p_request_id: input.requestId, p_claim_token: claim.claimToken, p_updates: brandInsert,
      p_result: { contract, contractHash, importReceipt: { id: input.importId, updatedAt: importRow.updated_at, assetIds: referencedAssetIds, conflicts: conflicts.map(conflict => ({ ...record(conflict), resolution: input.resolutions?.[String(record(conflict).field)] })) } },
    })
    if (!['applied','replayed'].includes(String(result.state))) throw new Error('The brand approval could not be saved. Reload the preview.')
    return { brandAssetId: String(result.brandAssetId), contract: result.contract as BrandForgeContractV1, contractHash: String(result.contractHash) }
  } catch (error) {
    try {
      const recovered = await brandRpc('finish_brand_operation', { p_request_id: input.requestId, p_claim_token: claim.claimToken, p_updates: {}, p_result: {}, p_error: 'save_failed' })
      if (recovered.state === 'replayed') return { brandAssetId: String(recovered.brandAssetId), contract: recovered.contract as BrandForgeContractV1, contractHash: String(recovered.contractHash) }
    } catch { /* Keep an unconfirmed request for explicit review. */ }
    throw error
  }
}
