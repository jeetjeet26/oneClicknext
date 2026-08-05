import { loadEnvConfig } from '@next/env'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { loadVerifiedSiteForgeRelease } from '@/utils/siteforge/artifacts/release'
import { createServiceClient } from '@/utils/supabase/admin'
import { CloudwaysClient } from '@/utils/siteforge/wordpress-client'
import { deployVerifiedReleaseThroughRuntime } from '@/utils/siteforge/workflows/runtime-preview'
import type { Json } from '@/types/supabase'

loadEnvConfig(process.cwd())

type ServiceClient = ReturnType<typeof createServiceClient>

export function selectLatestPublishedRuntimeV2Package(client: ServiceClient) {
  return client
    .from('siteforge_runtime_packages')
    .select('version, package_sha256')
    .eq('package_type', 'runtime_plugin')
    .eq('runtime_contract_version', 2)
    .eq('publication_status', 'published')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
}

export async function main() {
  const targetId = process.argv[2]
  if (!targetId) {
    throw new Error('Usage: provision-siteforge-runtime-v2.ts <target-id>')
  }
  const client = createServiceClient()
  const { data: target, error: targetError } = await client
    .from('siteforge_wordpress_targets')
    .select(
      'id, org_id, property_id, website_id, site_url, last_verified_content_hash'
    )
    .eq('id', targetId)
    .single()
  if (targetError || !target?.site_url) {
    throw new Error(
      `SiteForge WordPress target is unavailable: ${
        targetError?.message || 'missing site URL'
      }`
    )
  }
  const siteUrl = target.site_url.trim()
  const { data: website, error: websiteError } = await client
    .from('property_websites')
    .select('current_artifact_version_id')
    .eq('id', target.website_id)
    .single()
  if (websiteError || !website?.current_artifact_version_id) {
    throw new Error('SiteForge target has no current immutable artifact')
  }
  const { data: artifact, error: artifactError } = await client
    .from('siteforge_blueprint_versions')
    .select(
      'id, blueprint, content_hash, quality_report, quality_score, created_by, base_theme_package_id, base_theme_package_sha256'
    )
    .eq('id', website.current_artifact_version_id)
    .single()
  if (
    artifactError ||
    !artifact ||
    !artifact.created_by ||
    !artifact.base_theme_package_sha256
  ) {
    throw new Error(
      `Current artifact cannot migrate to runtime v2: ${
        artifactError?.message || 'missing author or base theme identity'
      }`
    )
  }
  const { data: runtimePackage, error: packageError } =
    await selectLatestPublishedRuntimeV2Package(client)
  if (packageError || !runtimePackage) {
    throw new Error('Publish an immutable SiteForge runtime package first')
  }
  const cloudways = new CloudwaysClient({
    apiKey: process.env.CLOUDWAYS_API_KEY || '',
    email: process.env.CLOUDWAYS_EMAIL || '',
  })
  const username = process.env.SITEFORGE_PREVIEW_WP_USERNAME || ''
  const applicationPassword =
    process.env.SITEFORGE_PREVIEW_WP_APP_PASSWORD || ''
  const instance = await cloudways.discoverWordPressInstance(siteUrl, {
    username,
    password: applicationPassword,
  })
  await cloudways.deployThemeAndPlugins(instance)

  const operationSet = [
    {
      operation: 'runtime_v2_migration',
      runtimeVersion: runtimePackage.version,
      runtimePackageSha256: runtimePackage.package_sha256,
    },
  ]
  const { data: revision, error: revisionError } = await client.rpc(
    'publish_siteforge_artifact_revision',
    {
      p_website_id: target.website_id,
      p_expected_artifact_id: artifact.id,
      p_blueprint: artifact.blueprint,
      p_content_hash: artifact.content_hash,
      p_change_type: 'edit',
      p_changes_summary: 'Bound artifact to permanent SiteForge runtime v2',
      p_edit_intent:
        'Migrate normal WordPress edits from provider installs to runtime transactions',
      p_patches_applied: operationSet as unknown as Json,
      p_quality_report: artifact.quality_report,
      p_quality_score: artifact.quality_score ?? 100,
      p_created_by: artifact.created_by,
      p_base_theme_package_id: artifact.base_theme_package_id ?? undefined,
      p_base_theme_package_sha256:
        artifact.base_theme_package_sha256 ?? undefined,
      p_runtime_contract_version: 2,
      p_runtime_package_sha256: runtimePackage.package_sha256,
      p_operation_set: operationSet as unknown as Json,
      p_operation_set_hash: hashSiteForgeContent(operationSet),
    }
  )
  if (revisionError || !revision) {
    throw new Error(
      `Failed to publish runtime v2 migration revision: ${
        revisionError?.message || 'missing revision'
      }`
    )
  }
  const release = await loadVerifiedSiteForgeRelease(
    {
      artifactId: revision.id,
      websiteId: target.website_id,
      propertyId: target.property_id,
      orgId: target.org_id,
      contentHash: revision.content_hash,
    },
    client
  )
  const deployed = await deployVerifiedReleaseThroughRuntime({
    release,
    siteUrl,
    username,
    applicationPassword,
    lastVerifiedContentHash: null,
    onProgress: (_stage, detail) => console.log(detail),
  })
  const now = new Date().toISOString()
  const { error: targetUpdateError } = await client
    .from('siteforge_wordpress_targets')
    .update({
      site_url: siteUrl,
      runtime_contract_version: 2,
      runtime_version: deployed.runtimeVersion,
      runtime_package_sha256: runtimePackage.package_sha256,
      last_verified_artifact_id: revision.id,
      last_verified_asset_manifest_hash: deployed.assetBindingHash,
      last_verified_content_hash: revision.content_hash,
      last_verified_operation_hash: deployed.operationHash,
      last_runtime_health_at: now,
      status: 'ready',
      updated_at: now,
    })
    .eq('id', target.id)
  if (targetUpdateError) throw new Error(targetUpdateError.message)
  await client
    .from('siteforge_edit_sessions')
    .update({ active_artifact_id: revision.id, last_activity_at: now })
    .eq('website_id', target.website_id)
    .eq('status', 'active')
  console.log(
    JSON.stringify(
      {
        targetId,
        artifactId: revision.id,
        contentHash: revision.content_hash,
        transactionId: deployed.deployment.transactionId,
        runtimeVersion: deployed.runtimeVersion,
      },
      null,
      2
    )
  )
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
