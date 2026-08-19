import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import type { SiteBlueprint } from '@/types/siteforge'
import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { siteForgeBlockContentSchemas } from '@/utils/siteforge/block-schemas'
import { createApprovedFloorPlanSnapshot } from './floor-plans'

export const PROPERTY_CONSOLE_SOURCE_IDENTITY = 'property-console'
const INVENTORY_BLOCK = 'acf/plans-availability'

type Client = SupabaseClient<Database>
type BlueprintRow = Database['public']['Tables']['siteforge_blueprint_versions']['Row']

export interface InventoryRevisionBlock {
  pageSlug: string
  pageTitle: string
  sectionId: string
  variant?: string
  content: Record<string, unknown>
}

export interface InventoryRevisionPreview {
  websiteId: string
  artifactId: string
  artifactVersion: number
  candidateContentHash: string
  inventoryContentHash: string
  changedBlockCount: number
  blocks: InventoryRevisionBlock[]
  blueprint: SiteBlueprint
  artifact: BlueprintRow
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export async function listPropertyConsoleFloorPlans(
  propertyId: string,
  client: Client = createServiceClient(),
  orgId?: string
) {
  let query = client
    .from('property_units')
    .select(
      'id, canonical_key, unit_type, bedrooms, bathrooms, sqft_min, sqft_max, rent_min, rent_max, available_count, move_in_specials, floor_plan_image_url, floor_plan_image_alt, availability_url, apply_url, effective_at, expires_at, source_updated_at, active, review_status'
    )
    .eq('property_id', propertyId)
    .eq('source', 'manual')
    .eq('source_identity', PROPERTY_CONSOLE_SOURCE_IDENTITY)
    .order('bedrooms', { ascending: true })
    .order('unit_type', { ascending: true })
  if (orgId) query = query.eq('org_id', orgId)
  const { data, error } = await query

  if (error) throw new Error(`Failed to load manual floor plans: ${error.message}`)
  return data || []
}

export async function archiveMissingPropertyConsoleFloorPlans(
  input: { propertyId: string; importId: string; orgId?: string },
  client: Client = createServiceClient()
) {
  let importQuery = client
    .from('property_unit_imports')
    .select('id, property_id, source_type, source_identity, status, preview')
    .eq('id', input.importId)
    .eq('property_id', input.propertyId)
  if (input.orgId) importQuery = importQuery.eq('org_id', input.orgId)
  const { data: importRecord, error: importError } = await importQuery.single()
  if (
    importError ||
    !importRecord ||
    importRecord.source_type !== 'manual' ||
    importRecord.source_identity !== PROPERTY_CONSOLE_SOURCE_IDENTITY ||
    importRecord.status !== 'applied'
  ) {
    throw new Error('Property-console import is not applied')
  }

  const preview = asRecord(importRecord.preview)
  const rows = Array.isArray(preview.rows) ? preview.rows : []
  const activeKeys = rows.flatMap((row) => {
    const key = asRecord(row).canonical_key
    return typeof key === 'string' && key ? [key] : []
  })

  let query = client
    .from('property_units')
    .update({ active: false, last_updated_at: new Date().toISOString() })
    .eq('property_id', input.propertyId)
    .eq('source', 'manual')
    .eq('source_identity', PROPERTY_CONSOLE_SOURCE_IDENTITY)
    .neq('import_id', input.importId)
  if (input.orgId) query = query.eq('org_id', input.orgId)
  if (activeKeys.length) query = query.not('canonical_key', 'in', `(${activeKeys.join(',')})`)
  const { error } = await query
  if (error) throw new Error(`Failed to archive omitted floor plans: ${error.message}`)
}

function inventoryBlockContent(
  original: Record<string, unknown>,
  snapshot: ReturnType<typeof createApprovedFloorPlanSnapshot>
) {
  return siteForgeBlockContentSchemas[INVENTORY_BLOCK].parse({
    ...original,
    data_source: 'manual',
    floor_plans: snapshot.rows.map((row) => ({
      id: row.id,
      name: row.name,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      sqft_min: row.sqftMin,
      sqft_max: row.sqftMax,
      rent_min: row.rentMin,
      rent_max: row.rentMax,
      available_count: row.availableCount,
      specials: row.specials,
      image_url: row.imageUrl,
      image_alt: row.imageUrl ? row.imageAlt || `${row.name} floor plan` : undefined,
      availability_url: row.availabilityUrl,
      apply_url: row.applyUrl,
      source: row.source,
      source_identity: row.sourceIdentity,
      effective_at: row.effectiveAt,
      expires_at: row.expiresAt,
      source_updated_at: row.sourceUpdatedAt,
    })),
    inventory_snapshot: {
      captured_at: snapshot.capturedAt,
      content_hash: snapshot.contentHash,
      max_age_hours:
        typeof original.freshness_hours === 'number' ? original.freshness_hours : 168,
    },
    display_style:
      ['cards', 'interactive', 'list'].includes(String(original.display_style))
        ? original.display_style
        : 'cards',
    filter_options: Array.isArray(original.filter_options)
      ? original.filter_options
      : ['bedrooms', 'bathrooms', 'square_footage', 'price', 'availability'],
    show_pricing: original.show_pricing !== false,
    show_availability: original.show_availability !== false,
    freshness_hours:
      typeof original.freshness_hours === 'number' ? original.freshness_hours : 168,
  })
}

export async function createManualInventoryRevisionPreview(
  input: {
    propertyId: string
    websiteId: string
    orgId?: string
    capturedAt?: string
  },
  client: Client = createServiceClient()
): Promise<InventoryRevisionPreview> {
  let websiteQuery = client
    .from('property_websites')
    .select('id, property_id, current_artifact_version_id')
    .eq('id', input.websiteId)
    .eq('property_id', input.propertyId)
  if (input.orgId) websiteQuery = websiteQuery.eq('org_id', input.orgId)
  const { data: website, error: websiteError } = await websiteQuery.single()
  if (websiteError || !website?.current_artifact_version_id) {
    throw new Error('SiteForge website has no current artifact')
  }

  let artifactQuery = client
    .from('siteforge_blueprint_versions')
    .select('*')
    .eq('id', website.current_artifact_version_id)
    .eq('website_id', input.websiteId)
  if (input.orgId) artifactQuery = artifactQuery.eq('org_id', input.orgId)
  const { data: artifact, error: artifactError } = await artifactQuery.single()
  if (artifactError || !artifact) throw new Error('Current SiteForge artifact not found')
  if (hashSiteForgeContent(artifact.blueprint) !== artifact.content_hash) {
    throw new Error('Current SiteForge artifact failed its content-hash check')
  }

  let unitsQuery = client
    .from('property_units')
    .select(
      'canonical_key, unit_type, bedrooms, bathrooms, sqft_min, sqft_max, rent_min, rent_max, available_count, move_in_specials, floor_plan_image_url, floor_plan_image_asset_id, floor_plan_image_alt, availability_url, apply_url, source, source_identity, effective_at, expires_at, source_updated_at'
    )
    .eq('property_id', input.propertyId)
    .eq('source', 'manual')
    .eq('active', true)
    .eq('review_status', 'approved')
    .order('canonical_key', { ascending: true })
  if (input.orgId) unitsQuery = unitsQuery.eq('org_id', input.orgId)
  const { data: units, error: unitsError } = await unitsQuery
  if (unitsError) throw new Error(`Failed to load approved manual inventory: ${unitsError.message}`)

  const snapshot = createApprovedFloorPlanSnapshot(
    units || [],
    input.capturedAt || new Date().toISOString()
  )
  const original = structuredClone(artifact.blueprint) as unknown as SiteBlueprint
  const candidate = structuredClone(original)
  const blocks: InventoryRevisionBlock[] = []

  for (const page of candidate.pages) {
    page.sections = page.sections.map((section) => {
      if (section.acfBlock !== INVENTORY_BLOCK) return section
      if (!section.id) throw new Error('Inventory blocks require stable section IDs')
      const content = inventoryBlockContent(asRecord(section.content), snapshot)
      blocks.push({
        pageSlug: page.slug,
        pageTitle: page.title,
        sectionId: section.id,
        variant: section.variant,
        content,
      })
      return { ...section, content }
    })
  }
  if (!blocks.length) throw new Error('Current SiteForge artifact has no floor-plan blocks')

  candidate.updatedAt = snapshot.capturedAt
  assertInventoryOnlyRevision(original, candidate)
  return {
    websiteId: input.websiteId,
    artifactId: artifact.id,
    artifactVersion: artifact.version,
    candidateContentHash: hashSiteForgeContent(candidate),
    inventoryContentHash: snapshot.contentHash,
    changedBlockCount: blocks.length,
    blocks,
    blueprint: candidate,
    artifact,
  }
}

export function assertInventoryOnlyRevision(
  original: SiteBlueprint,
  candidate: SiteBlueprint
): void {
  const stripInventory = (blueprint: SiteBlueprint) => ({
    ...blueprint,
    updatedAt: undefined,
    pages: blueprint.pages.map((page) => ({
      ...page,
      sections: page.sections.map((section) =>
        section.acfBlock === INVENTORY_BLOCK
          ? { ...section, content: '__inventory_managed__' }
          : section
      ),
    })),
  })
  if (
    hashSiteForgeContent(stripInventory(original)) !==
    hashSiteForgeContent(stripInventory(candidate))
  ) {
    throw new Error('Inventory revision attempted to alter unrelated website content')
  }
}

export async function publishManualInventoryRevision(
  input: {
    propertyId: string
    websiteId: string
    expectedArtifactId: string
    expectedCandidateContentHash: string
    expectedInventoryContentHash: string
    userId: string
    orgId?: string
    capturedAt: string
  },
  client: Client = createServiceClient()
) {
  const preview = await createManualInventoryRevisionPreview(
    {
      propertyId: input.propertyId,
      websiteId: input.websiteId,
      orgId: input.orgId,
      capturedAt: input.capturedAt,
    },
    client
  )
  if (
    preview.artifactId !== input.expectedArtifactId ||
    preview.candidateContentHash !== input.expectedCandidateContentHash ||
    preview.inventoryContentHash !== input.expectedInventoryContentHash
  ) {
    throw new Error('Inventory preview is stale; create and review a new preview')
  }

  const operationSet = preview.blocks.map((block) => ({
    op: 'inventory.replace',
    pageSlug: block.pageSlug,
    sectionId: block.sectionId,
    inventoryContentHash: preview.inventoryContentHash,
  }))
  const artifact = preview.artifact
  const { data, error } = await client.rpc('publish_siteforge_artifact_revision', {
    p_website_id: input.websiteId,
    p_expected_artifact_id: input.expectedArtifactId,
    p_blueprint: preview.blueprint as unknown as Json,
    p_content_hash: preview.candidateContentHash,
    // The existing immutable revision contract permits generation/edit/
    // rollback/import. This is a tightly constrained deterministic edit.
    p_change_type: 'edit',
    p_changes_summary: `Refresh ${preview.changedBlockCount} floor-plan availability block(s) from approved manual inventory`,
    p_edit_intent: 'Publish exact approved manual floor-plan inventory preview',
    p_patches_applied: operationSet as unknown as Json,
    p_quality_report: {
      deterministic: true,
      inventoryOnly: true,
      preservedUnrelatedContent: true,
      inventoryContentHash: preview.inventoryContentHash,
    } as unknown as Json,
    p_quality_score: 100,
    p_created_by: input.userId,
    p_asset_manifest: artifact.asset_manifest,
    ...(artifact.asset_manifest_hash
      ? { p_asset_manifest_hash: artifact.asset_manifest_hash }
      : {}),
    ...(artifact.base_theme_package_id
      ? { p_base_theme_package_id: artifact.base_theme_package_id }
      : {}),
    ...(artifact.base_theme_package_sha256
      ? { p_base_theme_package_sha256: artifact.base_theme_package_sha256 }
      : {}),
    p_runtime_contract_version: artifact.runtime_contract_version,
    ...(artifact.runtime_package_sha256
      ? { p_runtime_package_sha256: artifact.runtime_package_sha256 }
      : {}),
    p_operation_set: operationSet as unknown as Json,
    p_operation_set_hash: hashSiteForgeContent(operationSet),
  })
  if (error || !data) {
    throw new Error(`Failed to publish inventory-only revision: ${error?.message || 'missing revision'}`)
  }
  return { artifactId: data.id, version: data.version, contentHash: data.content_hash }
}
