/**
 * ForgeStudio trusted context assembler.
 *
 * Builds the evidence bundle the LLM is allowed to draw from:
 * authoritative property fields, ForgeStudio channel settings, the latest
 * BrandForge sections, property-scoped KB retrieval, operator-provided source
 * facts, and the user-selected community assets.
 *
 * Every source carries an explicit id/kind so generated claims can cite it,
 * and the exact bundle is persisted as a shared context snapshot before any
 * generation runs.
 */

import OpenAI from 'openai'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/utils/supabase/admin'
import type { Json } from '@/types/supabase'

export const CONTEXT_BUNDLE_VERSION = 'forgestudio.context.v1'

export type ContextSource = {
  /** Stable citation id, e.g. property_field:name, kb_document:<uuid>, asset:<uuid> */
  id: string
  kind:
    | 'property_field'
    | 'channel_settings'
    | 'brand_section'
    | 'kb_document'
    | 'asset'
    | 'operator_input'
  label: string
  content: string
  /** KB retrieval similarity, when applicable. */
  similarity?: number
  /** Provenance timestamp of the underlying record, when known. */
  recordedAt?: string | null
}

export type SelectedAsset = {
  id: string
  name: string
  assetType: string
  fileUrl: string
  thumbnailUrl: string | null
  description: string | null
  width: number | null
  height: number | null
  durationSeconds: number | null
}

export type TrustedContextBundle = {
  version: typeof CONTEXT_BUNDLE_VERSION
  propertyId: string
  assembledAt: string
  sources: ContextSource[]
  assets: SelectedAsset[]
  brandVoice: string | null
  targetAudience: string | null
  contextHash: string
}

function asText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function truncate(text: string, max = 2000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const BRAND_SECTIONS: Array<{ column: string; label: string }> = [
  { column: 'section_1_introduction', label: 'Brand introduction' },
  { column: 'section_2_positioning', label: 'Brand positioning' },
  { column: 'section_3_target_audience', label: 'Target audience' },
  { column: 'section_4_personas', label: 'Resident personas' },
  { column: 'section_5_name_story', label: 'Name story' },
]

async function retrieveKbSources(
  propertyId: string,
  query: string
): Promise<ContextSource[]> {
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey || !query.trim()) return []

  try {
    const openai = new OpenAI({ apiKey: openaiKey })
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    })
    const embedding = embeddingResponse.data[0].embedding

    const supabase = createServiceClient()
    const { data: documents, error } = await supabase.rpc('match_documents', {
      query_embedding: `[${embedding.join(',')}]`,
      match_threshold: 0.45,
      match_count: 6,
      filter_property: propertyId,
    })

    if (error || !documents) return []

    return documents.map((doc) => ({
      id: `kb_document:${doc.id}`,
      kind: 'kb_document' as const,
      label: 'Knowledge base document',
      content: truncate(String(doc.content ?? '')),
      similarity: Number(doc.similarity ?? 0),
    }))
  } catch (error) {
    console.error('[forgestudio] KB retrieval failed:', error)
    return []
  }
}

export async function assembleForgeStudioContext(input: {
  propertyId: string
  /** Retrieval query — usually the brief objective + topic. */
  query: string
  /** Operator-provided facts from the brief (trusted, user-authored). */
  sourceFacts?: Array<{ text: string; source?: string }>
  /** Explicitly selected asset ids from the brief. */
  assetIds?: string[]
}): Promise<TrustedContextBundle> {
  const supabase = createServiceClient()

  const [propertyResult, configResult, brandResult, assetsResult, kbSources] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name, address, property_type, website_url, unit_count, target_audience, brand_voice, updated_at')
      .eq('id', input.propertyId)
      .single(),
    supabase
      .from('forgestudio_config')
      .select('brand_voice, target_audience, key_amenities, include_hashtags, include_cta, max_caption_length, updated_at')
      .eq('property_id', input.propertyId)
      .maybeSingle(),
    supabase
      .from('property_brand_assets')
      .select('id, generation_status, updated_at, section_1_introduction, section_2_positioning, section_3_target_audience, section_4_personas, section_5_name_story')
      .eq('property_id', input.propertyId)
      .maybeSingle(),
    (input.assetIds?.length
      ? supabase
          .from('content_assets')
          .select('id, name, asset_type, file_url, thumbnail_url, description, width, height, duration_seconds')
          .in('id', input.assetIds)
          .eq('property_id', input.propertyId)
      : Promise.resolve({ data: [], error: null })),
    retrieveKbSources(input.propertyId, input.query),
  ])

  if (propertyResult.error || !propertyResult.data) {
    throw new Error(`Property not found for context assembly: ${propertyResult.error?.message}`)
  }

  const property = propertyResult.data
  const config = configResult.data
  const sources: ContextSource[] = []

  // 1. Authoritative property fields.
  const propertyFields: Array<[string, unknown]> = [
    ['name', property.name],
    ['address', property.address],
    ['property_type', property.property_type],
    ['website_url', property.website_url],
    ['unit_count', property.unit_count],
  ]
  for (const [field, value] of propertyFields) {
    const text = asText(value)
    if (!text) continue
    sources.push({
      id: `property_field:${field}`,
      kind: 'property_field',
      label: `Property ${field.replace(/_/g, ' ')}`,
      content: truncate(text, 500),
      recordedAt: property.updated_at,
    })
  }

  // 2. Channel settings / configured amenities.
  if (config?.key_amenities?.length) {
    sources.push({
      id: 'channel_settings:key_amenities',
      kind: 'channel_settings',
      label: 'Configured key amenities',
      content: config.key_amenities.join(', '),
      recordedAt: config.updated_at,
    })
  }

  // 3. Latest BrandForge sections (only when generation completed).
  const brand = brandResult.data
  if (brand && brand.generation_status === 'completed') {
    for (const section of BRAND_SECTIONS) {
      const raw = (brand as Record<string, unknown>)[section.column]
      const text = asText(raw)
      if (!text || text === '{}' || text === 'null') continue
      sources.push({
        id: `brand_section:${brand.id}:${section.column}`,
        kind: 'brand_section',
        label: section.label,
        content: truncate(text),
        recordedAt: brand.updated_at,
      })
    }
  }

  // 4. Property-scoped KB retrieval (untrusted evidence — cite or fail closed).
  sources.push(...kbSources)

  // 5. Operator-provided source facts from the brief (user-authored, trusted).
  for (const [index, fact] of (input.sourceFacts ?? []).entries()) {
    if (!fact.text?.trim()) continue
    sources.push({
      id: `operator_input:${index}`,
      kind: 'operator_input',
      label: fact.source ? `Operator fact (${fact.source})` : 'Operator fact',
      content: truncate(fact.text, 1000),
    })
  }

  // 6. Selected community assets.
  const assets: SelectedAsset[] = (assetsResult.data ?? []).map((asset) => ({
    id: asset.id,
    name: asset.name,
    assetType: asset.asset_type,
    fileUrl: asset.file_url,
    thumbnailUrl: asset.thumbnail_url,
    description: asset.description,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.duration_seconds,
  }))
  for (const asset of assets) {
    sources.push({
      id: `asset:${asset.id}`,
      kind: 'asset',
      label: `Community asset: ${asset.name} (${asset.assetType})`,
      content: truncate(asset.description || asset.name, 500),
    })
  }

  const bundleWithoutHash: Omit<TrustedContextBundle, 'contextHash'> = {
    version: CONTEXT_BUNDLE_VERSION,
    propertyId: input.propertyId,
    assembledAt: new Date().toISOString(),
    sources,
    assets,
    brandVoice: config?.brand_voice ?? property.brand_voice ?? null,
    targetAudience: config?.target_audience ?? property.target_audience ?? null,
  }

  const contextHash = createHash('sha256')
    .update(JSON.stringify({ ...bundleWithoutHash, assembledAt: undefined }))
    .digest('hex')

  return { ...bundleWithoutHash, contextHash }
}

/**
 * Persist the exact bundle used for a generation as a shared context snapshot.
 * Returns the snapshot id to link onto the revision.
 */
export async function persistContextSnapshot(input: {
  orgId: string
  propertyId: string
  bundle: TrustedContextBundle
  sourceRef?: string | null
  capturedBy?: string
}): Promise<string | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('shared_context_snapshots')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      source_domain: 'forgestudio.generation',
      source_ref: input.sourceRef ?? null,
      context_payload: input.bundle as unknown as Json,
      context_hash: input.bundle.contextHash,
      captured_by: input.capturedBy ?? 'system',
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    console.error('[forgestudio] failed to persist context snapshot:', error?.message)
    return null
  }
  return data.id
}
