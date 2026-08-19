import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  createApprovedFloorPlanSnapshot,
  type FloorPlanPreview,
} from './floor-plans'
import { enforceInventoryFreshness } from '@/utils/siteforge/operations/inventory'
import { isSyntheticInventorySource } from './inventory-policy'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export async function loadFreshApprovedFloorPlanInventory(
  propertyId: string,
  client: SupabaseClient<Database> = createServiceClient(),
  capturedAt = new Date().toISOString(),
  maxAgeHours = 24
) {
  const { data, error } = await client
    .from('property_units')
    .select(
      'canonical_key, unit_type, bedrooms, bathrooms, sqft_min, sqft_max, rent_min, rent_max, available_count, move_in_specials, floor_plan_image_url, floor_plan_image_asset_id, floor_plan_image_alt, availability_url, apply_url, effective_at, expires_at, source_updated_at, source, source_identity'
    )
    .eq('property_id', propertyId)
    .eq('active', true)
    .eq('review_status', 'approved')
    .order('canonical_key', { ascending: true })

  if (error) {
    throw new Error(`Failed to load approved floor-plan inventory: ${error.message}`)
  }

  const inventory = (data || []).filter(
    unit => !isSyntheticInventorySource(unit)
  )
  const freshness = enforceInventoryFreshness(
    inventory.map((unit) => ({
      ...unit,
      id: unit.canonical_key,
      rentMin: unit.rent_min ?? undefined,
      rentMax: unit.rent_max ?? undefined,
      availableCount: unit.available_count ?? undefined,
      effectiveAt: unit.effective_at ?? undefined,
      expiresAt: unit.expires_at ?? undefined,
      sourceUpdatedAt: unit.source_updated_at ?? unit.effective_at ?? undefined,
    })),
    {
      propertyId,
      provider: (inventory[0]?.source || 'siteforge') as 'siteforge',
      maxAgeHours,
      now: new Date(capturedAt),
    }
  )
  // Published inventory never expires (solo-operator doctrine): pricing and
  // availability stay live until the operator replaces them.
  return {
    snapshot: createApprovedFloorPlanSnapshot(inventory, capturedAt),
    revisionProposal: freshness.revisionProposal,
    stale: freshness.stale,
  }
}

export async function loadApprovedFloorPlanSnapshot(
  propertyId: string,
  client: SupabaseClient<Database> = createServiceClient(),
  capturedAt = new Date().toISOString()
) {
  return (await loadFreshApprovedFloorPlanInventory(propertyId, client, capturedAt)).snapshot
}

export async function createFloorPlanImportPreview(
  input: {
    orgId: string
    propertyId: string
    userId: string
    sourceType: 'manual' | 'csv'
    sourceIdentity: string
    originalFilename?: string
    preview: FloorPlanPreview
  },
  client: SupabaseClient<Database> = createServiceClient()
) {
  const importIdentity = hashSiteForgeContent({
    sourceType: input.sourceType,
    sourceIdentity: input.sourceIdentity,
    rows: input.preview.rows,
  })
  const { data: existing, error: existingError } = await client
    .from('property_unit_imports')
    .select('*')
    .eq('property_id', input.propertyId)
    .eq('idempotency_key', importIdentity)
    .maybeSingle()
  if (existingError) {
    throw new Error(`Failed to check floor-plan import identity: ${existingError.message}`)
  }
  if (existing) return existing

  const { data, error } = await client
    .from('property_unit_imports')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      source_type: input.sourceType,
      source_identity: input.sourceIdentity,
      idempotency_key: importIdentity,
      status: 'preview',
      original_filename: input.originalFilename || null,
      row_count: input.preview.rows.length,
      error_count: input.preview.errors.length,
      preview: { rows: input.preview.rows } as unknown as Json,
      errors: input.preview.errors as unknown as Json,
      created_by: input.userId,
    })
    .select('*')
    .single()
  if (error || !data) {
    throw new Error(`Failed to persist floor-plan import preview: ${error?.message}`)
  }
  return data
}

export async function confirmFloorPlanImport(
  importId: string,
  userId: string,
  client: SupabaseClient<Database> = createServiceClient()
) {
  const { data, error } = await client.rpc('apply_property_unit_import', {
    p_import_id: importId,
    p_confirmed_by: userId,
  })
  if (error) {
    throw new Error(`Failed to apply floor-plan import: ${error.message}`)
  }
  return { applied: data }
}
