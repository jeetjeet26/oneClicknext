import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { buildApprovedAssetManifest } from '@/utils/siteforge/editor/asset-manifest'

export const SITEFORGE_GENERATION_CHANGE_TYPE = 'generation' as const

export interface PublishSiteForgeArtifactInput {
  websiteId: string
  propertyId: string
  orgId: string
  sharedJobId: string
  sourcePlanVersionId: string
  blueprint: Json
  qualityReport: Json
  qualityScore: number
}

export interface PublishedSiteForgeArtifact {
  id: string
  version: number
  contentHash: string
}

export async function publishSiteForgeArtifact(
  input: PublishSiteForgeArtifactInput,
  client: SupabaseClient<Database> = createServiceClient()
): Promise<PublishedSiteForgeArtifact> {
  const contentHash = hashSiteForgeContent(input.blueprint)
  const { data: assetRows, error: assetError } = await client
    .from('website_assets')
    .select(
      'id, asset_type, source, file_url, original_url, storage_path, byte_sha256, content_hash, file_size_bytes, mime_type, alt_text, caption, width, height, focal_point, approval_status, rights_status, created_at'
    )
    .eq('website_id', input.websiteId)
    .order('id', { ascending: true })
  if (assetError) {
    throw new Error(`Failed to snapshot SiteForge assets: ${assetError.message}`)
  }
  const { assetManifest, assetManifestHash } = buildApprovedAssetManifest(
    (assetRows || []) as unknown as Json,
    input.blueprint
  )
  const operationSet = [
    {
      op: 'generation.publish',
      sharedJobId: input.sharedJobId,
      sourcePlanVersionId: input.sourcePlanVersionId,
    },
  ]
  const themePackage = await readFile(
    path.resolve(process.cwd(), 'runtime-assets/oneclick-siteforge.zip')
  )
  const baseThemePackageSha256 = createHash('sha256')
    .update(themePackage)
    .digest('hex')
  const blueprintRecord =
    input.blueprint && typeof input.blueprint === 'object' && !Array.isArray(input.blueprint)
      ? (input.blueprint as Record<string, Json | undefined>)
      : {}
  const themeArtifact =
    blueprintRecord.wordpressThemeArtifact &&
    typeof blueprintRecord.wordpressThemeArtifact === 'object' &&
    !Array.isArray(blueprintRecord.wordpressThemeArtifact)
      ? (blueprintRecord.wordpressThemeArtifact as Record<string, Json | undefined>)
      : {}
  const theme =
    themeArtifact.theme &&
    typeof themeArtifact.theme === 'object' &&
    !Array.isArray(themeArtifact.theme)
      ? (themeArtifact.theme as Record<string, Json | undefined>)
      : {}
  const baseThemePackageId =
    typeof theme.version === 'string'
      ? `oneclick-siteforge@${theme.version}`
      : 'oneclick-siteforge'
  const { data: created, error: createError } = await client.rpc(
    'publish_siteforge_artifact_revision',
    {
      p_website_id: input.websiteId,
      // Initial publication uses the website identity as a typed no-parent
      // sentinel. The database function accepts it only for generation when
      // the canonical projection has no current artifact.
      p_expected_artifact_id: input.websiteId,
      p_blueprint: input.blueprint,
      p_content_hash: contentHash,
      p_change_type: SITEFORGE_GENERATION_CHANGE_TYPE,
      p_changes_summary: 'Initial SiteForge generation from confirmed plan',
      p_edit_intent: 'Publish confirmed SiteForge plan output',
      p_patches_applied: {
        sharedJobId: input.sharedJobId,
        sourcePlanVersionId: input.sourcePlanVersionId,
        assetManifest,
        assetManifestHash,
      } as unknown as Json,
      p_quality_report: input.qualityReport,
      p_quality_score: input.qualityScore,
      // Generation artifacts are system-authored; the SQL function persists
      // a null author for this change type.
      p_created_by: input.websiteId,
      p_base_theme_package_id: baseThemePackageId,
      p_base_theme_package_sha256: baseThemePackageSha256,
      p_asset_manifest: assetManifest,
      p_asset_manifest_hash: assetManifestHash,
      p_operation_set: operationSet as unknown as Json,
      p_operation_set_hash: hashSiteForgeContent(operationSet),
    }
  )

  if (createError || !created) {
    throw new Error(
      `Failed to publish immutable SiteForge artifact: ${
        createError?.message || 'missing transaction result'
      }`
    )
  }

  return {
    id: created.id,
    version: created.version,
    contentHash: created.content_hash,
  }
}
