import type { Tables } from '@/types/supabase'

export function presentAssetSource(
  source: Tables<'siteforge_asset_sources'>
) {
  return {
    id: source.id,
    propertyId: source.property_id,
    websiteId: source.website_id,
    provider: source.provider,
    status: source.status,
    externalFolderId: source.external_folder_id,
    externalFolderName: source.external_folder_name,
    hasCredential: Boolean(source.credential_ref),
    scopes: source.scope_manifest,
    checkpoint: source.checkpoint,
    lastSyncedAt: source.last_synced_at,
    lastError: source.last_error,
    createdAt: source.created_at,
    updatedAt: source.updated_at,
  }
}
