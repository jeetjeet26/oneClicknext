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
import { getAssetUsability } from '@/utils/siteforge/assets/curation'
import { buildBusinessContextBridge } from '@/utils/substrate/business-context-bridge'

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
    | 'approved_snapshot'
    | 'legal_policy'
    | 'structured_inventory'
    | 'approved_poi'
    | 'approved_testimonial'
    | 'market_signal'
    | 'performance_signal'
  label: string
  content: string
  /** KB retrieval similarity, when applicable. */
  similarity?: number
  /** Provenance timestamp of the underlying record, when known. */
  recordedAt?: string | null
  effectiveAt?: string | null
  expiresAt?: string | null
  authority: 'policy' | 'authoritative' | 'curated' | 'advisory' | 'provisional'
  approvalStatus?: string | null
  confidence?: number | null
  sensitivity: 'public' | 'sensitive' | 'restricted'
  allowedUses: Array<'claim' | 'tone' | 'topic' | 'timing' | 'format'>
  stale?: boolean
  conflicted?: boolean
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
  altText: string | null
  rightsStatus: string
  approvalStatus: string
  curationStatus: string
}

export type ContextWarning = {
  code: string
  message: string
  sourceId?: string
}

export type TrustedContextBundle = {
  version: typeof CONTEXT_BUNDLE_VERSION
  propertyId: string
  assembledAt: string
  sources: ContextSource[]
  assets: SelectedAsset[]
  brandVoice: string | null
  targetAudience: string | null
  warnings: ContextWarning[]
  policy: {
    legalConfigId: string | null
    fairHousingRequired: boolean
    sensitiveClaimsRequireApproval: true
  }
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

function sanitizeAudience(value: string | null | undefined): string | null {
  const audience = value?.trim()
  if (!audience) return null
  const protectedOrProxyTerms =
    /\b(young|old|senior|retiree|student|professional|family|families|single|christian|jewish|muslim|hindu|white|black|asian|hispanic|disabled|section 8)\b/i
  return protectedOrProxyTerms.test(audience) ? null : audience
}

function isExpired(value: string | null | undefined, now: Date): boolean {
  return Boolean(value && new Date(value) <= now)
}

function parseMarketSignalSource(source?: string): boolean {
  return Boolean(source?.startsWith('marketvision_proposal:'))
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
      authority: 'curated' as const,
      sensitivity: 'public' as const,
      allowedUses: ['claim', 'topic'] as Array<'claim' | 'topic'>,
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
  const now = new Date()
  const nowIso = now.toISOString()
  const wantsTestimonials = /\b(review|testimonial|resident story)\b/i.test(input.query)

  const [
    propertyResult,
    configResult,
    onboardingResult,
    legalResult,
    brandResult,
    assetsResult,
    unitsResult,
    poiResult,
    testimonialResult,
    kbSources,
    businessContextResult,
  ] = await Promise.all([
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
      .from('property_onboarding_snapshots')
      .select('id, status, snapshot_payload, content_hash, unresolved_conflicts, approved_at, updated_at')
      .eq('property_id', input.propertyId)
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('property_legal_configs')
      .select('id, status, version, fair_housing, pricing_disclaimer, accessibility, effective_at, approved_at')
      .eq('property_id', input.propertyId)
      .eq('status', 'approved')
      .lte('effective_at', nowIso)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('property_brand_assets')
      .select('id, generation_status, approval_status, contract_version, contract_hash, approved_at, updated_at, section_1_introduction, section_2_positioning, section_3_target_audience, section_4_personas, section_5_name_story, section_6_logo, section_7_typography, section_8_colors, section_9_design_elements, section_10_photo_yep, section_11_photo_nope, section_12_implementation')
      .eq('property_id', input.propertyId)
      .maybeSingle(),
    (input.assetIds?.length
      ? supabase
          .from('content_assets')
          .select('id, name, asset_type, file_url, thumbnail_url, description, width, height, duration_seconds, alt_text, rights_status, approval_status, curation_status, expires_at, duplicate_of')
          .in('id', input.assetIds)
          .eq('property_id', input.propertyId)
      : Promise.resolve({ data: [], error: null })),
    supabase
      .from('property_units')
      .select('id, unit_type, bedrooms, bathrooms, sqft_min, sqft_max, rent_min, rent_max, available_count, move_in_specials, effective_at, source_updated_at, expires_at, confidence, review_status, source_identity')
      .eq('property_id', input.propertyId)
      .eq('active', true)
      .eq('review_status', 'approved')
      .order('effective_at', { ascending: false })
      .limit(50),
    supabase
      .from('property_points_of_interest')
      .select('id, name, category, address, distance_miles, travel_time_minutes, source_url, captured_at, confidence, approval_status, approved_at')
      .eq('property_id', input.propertyId)
      .eq('approval_status', 'approved')
      .order('confidence', { ascending: false })
      .limit(20),
    wantsTestimonials
      ? supabase
          .from('review_testimonial_approvals')
          .select('id, status, review_text_snapshot, reviewer_name_snapshot, rating_snapshot, platform_snapshot, attribution_approved, rights_basis, approved_at, revoked_at')
          .eq('property_id', input.propertyId)
          .eq('status', 'approved')
          .is('revoked_at', null)
          .order('approved_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    retrieveKbSources(input.propertyId, input.query),
    buildBusinessContextBridge({ from: supabase.from.bind(supabase) }, input.propertyId)
      .then((data) => ({ data, error: null }))
      .catch((error: unknown) => ({ data: null, error })),
  ])

  if (propertyResult.error || !propertyResult.data) {
    throw new Error(`Property not found for context assembly: ${propertyResult.error?.message}`)
  }

  const property = propertyResult.data
  const config = configResult.data
  const sources: ContextSource[] = []
  const warnings: ContextWarning[] = []

  // 1. Mandatory approved policy envelope.
  const legal = legalResult.data
  if (legal) {
    sources.push({
      id: `legal_policy:${legal.id}`,
      kind: 'legal_policy',
      label: `Approved legal and Fair Housing policy v${legal.version}`,
      content: truncate(asText({
        fairHousing: legal.fair_housing,
        pricingDisclaimer: legal.pricing_disclaimer,
        accessibility: legal.accessibility,
      }), 3000),
      recordedAt: legal.approved_at,
      effectiveAt: legal.effective_at,
      authority: 'policy',
      approvalStatus: legal.status,
      sensitivity: 'public',
      allowedUses: ['claim', 'tone'],
    })
  } else {
    warnings.push({
      code: 'missing_approved_legal_policy',
      message: 'No effective approved property legal policy is available; sensitive claims must remain blocked.',
    })
  }

  // 2. Approved onboarding snapshot is the preferred durable property truth.
  const onboarding = onboardingResult.data
  if (onboarding) {
    const conflicts = Array.isArray(onboarding.unresolved_conflicts)
      ? onboarding.unresolved_conflicts.length > 0
      : Boolean(onboarding.unresolved_conflicts)
    sources.push({
      id: `approved_snapshot:${onboarding.id}`,
      kind: 'approved_snapshot',
      label: 'Approved property onboarding snapshot',
      content: truncate(asText(onboarding.snapshot_payload), 5000),
      recordedAt: onboarding.approved_at ?? onboarding.updated_at,
      authority: 'authoritative',
      approvalStatus: onboarding.status,
      sensitivity: 'public',
      allowedUses: ['claim', 'tone', 'topic'],
      conflicted: conflicts,
    })
    if (conflicts) {
      warnings.push({
        code: 'approved_snapshot_conflicts',
        message: 'The approved onboarding snapshot still contains unresolved conflicts; conflicting facts cannot be used as claims.',
        sourceId: `approved_snapshot:${onboarding.id}`,
      })
    }
  } else {
    warnings.push({
      code: 'missing_approved_onboarding_snapshot',
      message: 'No approved onboarding snapshot is available; raw property fields are fallback evidence only.',
    })
  }

  // 3. Raw property fields are fallback authoritative records.
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
      authority: onboarding ? 'curated' : 'authoritative',
      sensitivity: 'public',
      allowedUses: ['claim', 'topic'],
    })
  }

  // 4. Channel settings / configured amenities.
  if (config?.key_amenities?.length) {
    sources.push({
      id: 'channel_settings:key_amenities',
      kind: 'channel_settings',
      label: 'Configured key amenities',
      content: config.key_amenities.join(', '),
      recordedAt: config.updated_at,
      authority: 'provisional',
      sensitivity: 'public',
      allowedUses: ['topic'],
    })
  }

  // 5. Full approved BrandForge contract.
  const brand = brandResult.data
  const approvedBrand =
    brand &&
    ['complete', 'completed'].includes(brand.generation_status ?? '') &&
    brand.approval_status === 'approved' &&
    Boolean(brand.contract_hash)
  if (approvedBrand) {
    const allBrandSections = [
      ...BRAND_SECTIONS,
      { column: 'section_6_logo', label: 'Logo system' },
      { column: 'section_7_typography', label: 'Typography system' },
      { column: 'section_8_colors', label: 'Color system' },
      { column: 'section_9_design_elements', label: 'Design elements' },
      { column: 'section_10_photo_yep', label: 'Approved photography direction' },
      { column: 'section_11_photo_nope', label: 'Prohibited photography direction' },
      { column: 'section_12_implementation', label: 'Locked brand implementation rules' },
    ]
    for (const section of allBrandSections) {
      const raw = (brand as Record<string, unknown>)[section.column]
      const text = asText(raw)
      if (!text || text === '{}' || text === 'null') continue
      sources.push({
        id: `brand_section:${brand.id}:${section.column}`,
        kind: 'brand_section',
        label: section.label,
        content: truncate(text),
        recordedAt: brand.approved_at ?? brand.updated_at,
        authority: 'authoritative',
        approvalStatus: brand.approval_status,
        sensitivity: section.column === 'section_4_personas' ? 'restricted' : 'public',
        allowedUses: section.column === 'section_4_personas' ? ['tone'] : ['tone', 'topic', 'format'],
      })
    }
  } else if (brand) {
    warnings.push({
      code: 'brand_contract_not_approved',
      message: 'BrandForge content exists but is incomplete, unapproved, or missing its contract hash.',
      sourceId: `brand:${brand.id}`,
    })
  }

  // 6. Property-scoped KB retrieval (curated evidence, freshness-aware when metadata exists).
  sources.push(...kbSources)

  // 7. Structured inventory is the only source for pricing, concessions, and availability.
  for (const unit of unitsResult.data ?? []) {
    const stale = isExpired(unit.expires_at, now)
    const content = {
      unitType: unit.unit_type,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      squareFeet: [unit.sqft_min, unit.sqft_max],
      rent: [unit.rent_min, unit.rent_max],
      availableCount: unit.available_count,
      moveInSpecials: unit.move_in_specials,
      sourceIdentity: unit.source_identity,
    }
    sources.push({
      id: `structured_inventory:${unit.id}`,
      kind: 'structured_inventory',
      label: `Approved inventory: ${unit.unit_type}`,
      content: truncate(asText(content), 1500),
      recordedAt: unit.source_updated_at,
      effectiveAt: unit.effective_at,
      expiresAt: unit.expires_at,
      authority: 'authoritative',
      approvalStatus: unit.review_status,
      confidence: unit.confidence,
      sensitivity: 'sensitive',
      allowedUses: stale ? ['topic'] : ['claim', 'topic'],
      stale,
    })
  }

  // 8. Approved neighborhood POIs may support bounded location claims.
  for (const poi of poiResult.data ?? []) {
    sources.push({
      id: `approved_poi:${poi.id}`,
      kind: 'approved_poi',
      label: `Approved point of interest: ${poi.name}`,
      content: truncate(asText({
        category: poi.category,
        address: poi.address,
        distanceMiles: poi.distance_miles,
        travelTimeMinutes: poi.travel_time_minutes,
        sourceUrl: poi.source_url,
      }), 1000),
      recordedAt: poi.captured_at,
      authority: 'authoritative',
      approvalStatus: poi.approval_status,
      confidence: poi.confidence,
      sensitivity: 'sensitive',
      allowedUses: ['claim', 'topic'],
    })
  }

  // 9. Testimonials enter context only through active rights-bearing approvals.
  for (const testimonial of testimonialResult.data ?? []) {
    sources.push({
      id: `approved_testimonial:${testimonial.id}`,
      kind: 'approved_testimonial',
      label: 'Approved resident testimonial',
      content: truncate(asText({
        text: testimonial.review_text_snapshot,
        attribution: testimonial.attribution_approved
          ? testimonial.reviewer_name_snapshot
          : null,
        rating: testimonial.rating_snapshot,
        platform: testimonial.platform_snapshot,
        rightsBasis: testimonial.rights_basis,
      }), 1500),
      recordedAt: testimonial.approved_at,
      authority: 'authoritative',
      approvalStatus: testimonial.status,
      sensitivity: 'sensitive',
      allowedUses: ['claim', 'topic'],
    })
  }

  // 10. Read-only performance summaries can guide topic/format/timing, never public claims.
  if (businessContextResult.data) {
    const bridge = businessContextResult.data
    sources.push({
      id: `performance_signal:${input.propertyId}:${bridge.asOf.slice(0, 10)}`,
      kind: 'performance_signal',
      label: 'Read-only 30-day marketing performance summary',
      content: truncate(asText({
        marketing30d: bridge.bi.marketing30d,
        importState: bridge.bi.lastImportState,
        hasImportWarnings: bridge.bi.hasImportWarnings,
      }), 1000),
      recordedAt: bridge.asOf,
      authority: 'advisory',
      sensitivity: 'restricted',
      allowedUses: ['topic', 'timing', 'format'],
    })
  } else {
    warnings.push({
      code: 'performance_context_unavailable',
      message: 'Read-only performance context was unavailable and was omitted.',
    })
  }

  // 11. Operator and cross-product proposal facts remain provisional.
  for (const [index, fact] of (input.sourceFacts ?? []).entries()) {
    if (!fact.text?.trim()) continue
    const fromMarketVision = parseMarketSignalSource(fact.source)
    sources.push({
      id: `operator_input:${index}`,
      kind: fromMarketVision ? 'market_signal' : 'operator_input',
      label: fromMarketVision
        ? 'MarketVision recommendation evidence'
        : fact.source
          ? `Operator fact (${fact.source})`
          : 'Operator fact',
      content: truncate(fact.text, 1000),
      authority: fromMarketVision ? 'advisory' : 'provisional',
      sensitivity: fromMarketVision ? 'restricted' : 'sensitive',
      allowedUses: fromMarketVision ? ['topic', 'timing', 'format'] : ['topic'],
    })
  }

  // 12. Selected community assets must pass the shared rights/curation gate.
  const assets: SelectedAsset[] = []
  for (const asset of assetsResult.data ?? []) {
    const usability = getAssetUsability(asset, now)
    if (!usability.usable || !asset.file_url.startsWith('https://')) {
      warnings.push({
        code: 'asset_not_usable',
        message: `Asset "${asset.name}" was omitted: ${[
          ...usability.blockers,
          ...(!asset.file_url.startsWith('https://') ? ['https_required'] : []),
        ].join(', ')}`,
        sourceId: `asset:${asset.id}`,
      })
      continue
    }
    assets.push({
      id: asset.id,
      name: asset.name,
      assetType: asset.asset_type,
      fileUrl: asset.file_url,
      thumbnailUrl: asset.thumbnail_url,
      description: asset.description,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.duration_seconds,
      altText: asset.alt_text,
      rightsStatus: asset.rights_status,
      approvalStatus: asset.approval_status,
      curationStatus: asset.curation_status,
    })
  }
  for (const asset of assets) {
    sources.push({
      id: `asset:${asset.id}`,
      kind: 'asset',
      label: `Community asset: ${asset.name} (${asset.assetType})`,
      content: truncate(asset.description || asset.name, 500),
      authority: 'authoritative',
      approvalStatus: asset.approvalStatus,
      sensitivity: 'public',
      allowedUses: ['claim', 'topic', 'format'],
    })
  }

  const bundleWithoutHash: Omit<TrustedContextBundle, 'contextHash'> = {
    version: CONTEXT_BUNDLE_VERSION,
    propertyId: input.propertyId,
    assembledAt: new Date().toISOString(),
    sources,
    assets,
    brandVoice: config?.brand_voice ?? property.brand_voice ?? null,
    targetAudience: sanitizeAudience(config?.target_audience ?? property.target_audience),
    warnings,
    policy: {
      legalConfigId: legal?.id ?? null,
      fairHousingRequired: true,
      sensitiveClaimsRequireApproval: true,
    },
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
