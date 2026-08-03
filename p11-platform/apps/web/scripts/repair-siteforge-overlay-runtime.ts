import { strFromU8, unzipSync } from 'fflate'
import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { validateAndStoreThemeOverlay } from '@/utils/siteforge/editor/overlay'
import { replaceWordPressThemeArtifactOverlay } from '@/utils/siteforge/wordpress/theme-artifact'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Copy the deployed theme-artifact color tokens into the semantic site
 * configuration so both color stores agree. The theme tokens are the source
 * of truth here because they are what WordPress rendered and the operator
 * approved; drift in siteConfiguration would otherwise be re-copied into the
 * theme tokens on the next semantic edit and change the live palette.
 */
function alignSiteConfigurationColorsToThemeTokens(
  blueprint: Record<string, unknown>
) {
  const tokenColors = asRecord(
    asRecord(asRecord(blueprint.wordpressThemeArtifact).designTokens).colors
  )
  const required = ['primary', 'secondary', 'accent', 'background', 'text']
  for (const role of required) {
    if (typeof tokenColors[role] !== 'string') {
      throw new Error(
        `Theme artifact design tokens are missing the ${role} color`
      )
    }
  }

  const siteConfiguration = asRecord(blueprint.siteConfiguration)
  const design = asRecord(siteConfiguration.design)
  design.colors = Object.fromEntries(
    required.map(role => [role, tokenColors[role]])
  )
  siteConfiguration.design = design
  blueprint.siteConfiguration = siteConfiguration
}

async function main() {
const artifactId = process.argv[2]
if (!artifactId) {
  throw new Error('Usage: repair-siteforge-overlay-runtime.ts <artifact-id>')
}

const client = createServiceClient()
const { data: artifact, error: artifactError } = await client
  .from('siteforge_blueprint_versions')
  .select(
    'id, website_id, property_id, org_id, created_by, blueprint, quality_report, quality_score, base_theme_package_id, base_theme_package_sha256'
  )
  .eq('id', artifactId)
  .single()
if (artifactError || !artifact || !artifact.created_by) {
  throw new Error(
    `Current artifact is unavailable: ${artifactError?.message || artifactId}`
  )
}

const blueprint = structuredClone(artifact.blueprint) as Record<string, unknown>
alignSiteConfigurationColorsToThemeTokens(blueprint)
const overlayIdentity = blueprint.themeOverlayIdentity as
  | { overlayId?: unknown }
  | undefined
if (typeof overlayIdentity?.overlayId !== 'string') {
  throw new Error('Artifact has no theme overlay to repair')
}

const { data: sourceOverlay, error: overlayError } = await client
  .from('siteforge_theme_overlays')
  .select('id, storage_path, manifest')
  .eq('id', overlayIdentity.overlayId)
  .eq('website_id', artifact.website_id)
  .single()
if (overlayError || !sourceOverlay) {
  throw new Error(
    `Source overlay is unavailable: ${overlayError?.message || overlayIdentity.overlayId}`
  )
}

const { data: archive, error: downloadError } = await client.storage
  .from('siteforge-artifacts')
  .download(sourceOverlay.storage_path)
if (downloadError || !archive) {
  throw new Error(
    `Source overlay package is unavailable: ${downloadError?.message || sourceOverlay.storage_path}`
  )
}

const files = unzipSync(new Uint8Array(await archive.arrayBuffer()))
const descriptor = JSON.parse(
  strFromU8(files['siteforge-overlay.json'])
) as { reason?: unknown; manifest?: { files?: Array<{ path?: unknown }> } }
const proposalFiles = (descriptor.manifest?.files || [])
  .filter(file => file.path !== 'functions.php')
  .map(file => {
    if (typeof file.path !== 'string' || !files[file.path]) {
      throw new Error('Source overlay manifest references a missing file')
    }
    return { path: file.path, content: strFromU8(files[file.path]) }
  })
if (!proposalFiles.length) {
  throw new Error('Source overlay contains no editable proposal files')
}

const signingSecret = process.env.SITEFORGE_OVERLAY_SIGNING_SECRET
const repairedOverlay = signingSecret
  ? await validateAndStoreThemeOverlay(
      {
        orgId: artifact.org_id,
        propertyId: artifact.property_id,
        websiteId: artifact.website_id,
        userId: artifact.created_by,
        proposal: {
          reason:
            typeof descriptor.reason === 'string'
              ? `${descriptor.reason} Runtime packaging repair.`
              : 'Repair overlay runtime packaging without changing visual intent.',
          files: proposalFiles,
        },
      },
      { signingSecret }
    )
  : null

if (repairedOverlay) {
  blueprint.themeOverlayIdentity = {
    overlayId: repairedOverlay.overlayId,
    contentHash: repairedOverlay.contentHash,
    packageSha256: repairedOverlay.packageSha256,
    signature: repairedOverlay.signature,
    storagePath: repairedOverlay.storagePath,
  }
  blueprint.wordpressThemeArtifact = replaceWordPressThemeArtifactOverlay(
    blueprint.wordpressThemeArtifact,
    repairedOverlay.manifest
  )
}
blueprint.updatedAt = new Date().toISOString()
const contentHash = hashSiteForgeContent(blueprint)
const repairOperation = {
  operation: 'overlay_runtime_repair',
  sourceOverlayId: sourceOverlay.id,
  repairedOverlayId: repairedOverlay?.overlayId || sourceOverlay.id,
  overlayRepackaged: Boolean(repairedOverlay),
  alignedSiteConfigurationColors: true,
}

const { data: revision, error: revisionError } = await client.rpc(
  'publish_siteforge_artifact_revision',
  {
    p_website_id: artifact.website_id,
    p_expected_artifact_id: artifact.id,
    p_blueprint: blueprint as Json,
    p_content_hash: contentHash,
    p_change_type: 'edit',
    p_changes_summary:
      'Aligned semantic color configuration with the approved deployed theme tokens',
    p_edit_intent:
      'Keep the operator-approved palette stable across future semantic edits',
    p_patches_applied: repairOperation,
    p_quality_report: artifact.quality_report || {},
    p_quality_score: artifact.quality_score ?? 0,
    p_created_by: artifact.created_by,
    ...(artifact.base_theme_package_id
      ? { p_base_theme_package_id: artifact.base_theme_package_id }
      : {}),
    ...(artifact.base_theme_package_sha256
      ? { p_base_theme_package_sha256: artifact.base_theme_package_sha256 }
      : {}),
    p_operation_set: [repairOperation] as unknown as Json,
    p_operation_set_hash: hashSiteForgeContent([repairOperation]),
  }
)
if (revisionError || !revision) {
  throw new Error(
    `Failed to publish repaired overlay revision: ${
      revisionError?.message || 'missing revision'
    }`
  )
}

await client
  .from('siteforge_edit_sessions')
  .update({
    active_artifact_id: revision.id,
    last_activity_at: new Date().toISOString(),
  })
  .eq('website_id', artifact.website_id)
  .eq('active_artifact_id', artifact.id)

process.stdout.write(
  `${JSON.stringify({
    sourceArtifactId: artifact.id,
    artifactId: revision.id,
    version: revision.version,
    overlayId: repairedOverlay?.overlayId || sourceOverlay.id,
    overlayRepackaged: Boolean(repairedOverlay),
  })}\n`
)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
