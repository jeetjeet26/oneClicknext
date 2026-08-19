import { createHash } from 'node:crypto'
import { createServiceClient } from '../utils/supabase/admin'
import {
  brandContractToStorageSections,
  hashBrandForgeContract,
  normalizeBrandAssetRow,
} from '../utils/brandforge/normalize'

const roleMap = {
  primary: 'primary_logo',
  secondary: 'secondary_logo',
  monochrome: 'monochrome_logo',
  mark: 'brand_mark',
  favicon: 'favicon',
} as const

async function main() {
  const client = createServiceClient()
  const requestedBrandAssetId = process.argv[2]?.trim()
  let query = client
    .from('property_brand_assets')
    .select('*, properties!inner(org_id)')
    .or('generation_status.eq.complete,approval_status.eq.approved')
  if (requestedBrandAssetId) query = query.eq('id', requestedBrandAssetId)
  const { data: rows, error } = await query
  if (error) throw new Error(`Failed to load BrandForge rows: ${error.message}`)

  let updated = 0
  let assetsCreated = 0
  for (const row of rows || []) {
    if (!row.property_id) {
      throw new Error(`BrandForge row ${row.id} has no property`)
    }
    const contract = normalizeBrandAssetRow(
      row as unknown as Record<string, unknown>,
    )
    const contractHash = hashBrandForgeContract(contract)
    const approvedAt = row.approved_at || row.updated_at || new Date().toISOString()
    const { error: updateError } = await client
      .from('property_brand_assets')
      .update({
        ...brandContractToStorageSections(contract),
        contract_version: contract.contractVersion,
        brand_origin: row.brand_origin || 'generated',
        approval_status: 'approved',
        contract_hash: contractHash,
        approved_at: approvedAt,
      })
      .eq('id', row.id)
    if (updateError) {
      throw new Error(`Failed to backfill BrandForge row ${row.id}: ${updateError.message}`)
    }
    updated += 1

    const orgId = row.properties?.org_id
    if (!orgId) throw new Error(`BrandForge row ${row.id} has no organization`)
    for (const logo of contract.logos.variants) {
      if (!logo.url) continue
      const response = await fetch(logo.url, {
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null)
      if (!response?.ok) {
        console.warn(`Skipped unreachable logo for ${row.id}: ${logo.url}`)
        continue
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      const contentHash = createHash('sha256').update(bytes).digest('hex')
      const { data: existing } = await client
        .from('content_assets')
        .select('id')
        .eq('property_id', row.property_id)
        .eq('content_hash', contentHash)
        .maybeSingle()
      if (existing) continue
      const { error: assetError } = await client.from('content_assets').insert({
        org_id: orgId,
        property_id: row.property_id,
        name: `${contract.identity.name || 'Property'} ${logo.role} logo`,
        description: 'Backfilled from an approved generated BrandForge contract',
        asset_type: 'image',
        asset_role: roleMap[logo.role],
        file_url: logo.url,
        file_size_bytes: bytes.byteLength,
        format: response.headers.get('content-type') || 'application/octet-stream',
        content_hash: contentHash,
        source_identity: `brandforge:${row.id}:${logo.role}`,
        source_metadata: { brandAssetId: row.id, originalUrl: logo.url },
        rights_status: 'generated',
        approval_status: 'approved',
        approved_at: approvedAt,
        alt_text: logo.alt,
      })
      if (assetError && assetError.code !== '23505') {
        throw new Error(`Failed to backfill logo for ${row.id}: ${assetError.message}`)
      }
      if (!assetError) assetsCreated += 1
    }
  }

  console.info(`Backfilled ${updated} BrandForge contracts and ${assetsCreated} governed logo assets.`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
