import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { isTrustedCertificationRequired } from '@/utils/siteforge/editor/feature'

export interface CertifiedRenderedEditorEvidence {
  source: 'server_certification'
  certificationId: string
  reportHash: string
  policyVersion: string
  environment: 'preview' | 'staging' | 'production'
  report: Json
}

export interface UncertifiedRenderedEditorEvidence {
  source: 'certification_not_required'
  artifactId: string
  contentHash: string
  report: Json
}

export type RenderedEditorEvidence =
  CertifiedRenderedEditorEvidence | UncertifiedRenderedEditorEvidence

export interface SiteForgeEditorSnapshot {
  website: {
    id: string
    propertyId: string
    orgId: string
  }
  artifact: {
    id: string
    version: number
    contentHash: string
    blueprint: Json
    assetManifest: Json
    siteConfiguration: Json
    motionConfiguration: Json
    baseThemePackageId: string | null
    baseThemePackageSha256: string | null
    overlayPackageSha256: string | null
    runtimeContractVersion: number
    runtimePackageSha256: string | null
  }
  propertyEvidence: Json
  approvedAssets: Json
  revisionHistory: Json
  wordpressCapabilities: Json
  renderedEvidence: RenderedEditorEvidence
}

function asJson(value: unknown): Json {
  return value as Json
}

export async function buildSiteForgeEditorSnapshot(
  input: {
    websiteId: string
    expectedArtifactId: string
    expectedContentHash: string
  },
  client: SupabaseClient<Database> = createServiceClient()
): Promise<SiteForgeEditorSnapshot> {
  const { data: website, error: websiteError } = await client
    .from('property_websites')
    .select('id, property_id, org_id, current_artifact_version_id')
    .eq('id', input.websiteId)
    .single()
  if (websiteError || !website) {
    throw new Error(
      `Editor website not found: ${websiteError?.message || input.websiteId}`
    )
  }
  if (website.current_artifact_version_id !== input.expectedArtifactId) {
    throw new Error('SiteForge artifact version conflict')
  }

  const [
    artifactResult,
    propertyResult,
    assetsResult,
    revisionsResult,
    certificationResult,
    runtimeTargetResult,
  ] = await Promise.all([
    client
      .from('siteforge_blueprint_versions')
      .select(
        'id, version, content_hash, blueprint, asset_manifest, site_configuration, motion_configuration, base_theme_package_id, base_theme_package_sha256, overlay_package_sha256, runtime_contract_version, runtime_package_sha256'
      )
      .eq('id', input.expectedArtifactId)
      .eq('website_id', input.websiteId)
      .single(),
    client
      .from('properties')
      .select('*')
      .eq('id', website.property_id)
      .eq('org_id', website.org_id)
      .single(),
    client
      .from('website_assets')
      .select(
        'id, asset_type, source, file_url, original_url, storage_path, byte_sha256, content_hash, file_size_bytes, mime_type, alt_text, caption, width, height, focal_point, rights_status, approval_status, metadata, created_at'
      )
      .eq('website_id', website.id)
      .eq('approval_status', 'approved')
      .order('created_at', { ascending: false }),
    client
      .from('siteforge_blueprint_versions')
      .select(
        'id, version, content_hash, parent_version_id, change_type, changes_summary, edit_intent, patches_applied, quality_score, created_at'
      )
      .eq('website_id', website.id)
      .order('version', { ascending: false })
      .limit(20),
    client
      .from('siteforge_certification_evidence')
      .select('id, policy_version, environment, report_hash, report')
      .eq('website_id', website.id)
      .eq('artifact_id', input.expectedArtifactId)
      .eq('status', 'passed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('siteforge_wordpress_targets')
      .select(
        'id, runtime_contract_version, runtime_version, runtime_package_sha256, last_verified_content_hash, last_runtime_health_at'
      )
      .eq('website_id', website.id)
      .eq('target_type', 'canonical_preview')
      .eq('is_active', true)
      .maybeSingle(),
  ])

  if (artifactResult.error || !artifactResult.data) {
    throw new Error(
      `Editor artifact not found: ${artifactResult.error?.message || input.expectedArtifactId}`
    )
  }
  if (artifactResult.data.content_hash !== input.expectedContentHash) {
    throw new Error('SiteForge artifact hash conflict')
  }
  if (propertyResult.error || !propertyResult.data) {
    throw new Error(
      `Editor property evidence unavailable: ${propertyResult.error?.message || 'not found'}`
    )
  }
  if (assetsResult.error) {
    throw new Error(`Editor assets unavailable: ${assetsResult.error.message}`)
  }
  if (revisionsResult.error) {
    throw new Error(
      `Editor revision history unavailable: ${revisionsResult.error.message}`
    )
  }
  if (runtimeTargetResult.error) {
    throw new Error(
      `Editor WordPress runtime capability unavailable: ${runtimeTargetResult.error.message}`
    )
  }
  const certificationRequired = isTrustedCertificationRequired()
  if (
    certificationRequired &&
    (certificationResult.error || !certificationResult.data)
  ) {
    throw new Error(
      'Trusted rendered certification is required before semantic editing'
    )
  }
  if (
    certificationResult.data &&
    !['preview', 'staging', 'production'].includes(
      certificationResult.data.environment
    )
  ) {
    throw new Error('Rendered certification environment is invalid')
  }
  const renderedEvidence: RenderedEditorEvidence = certificationResult.data
    ? {
        source: 'server_certification',
        certificationId: certificationResult.data.id,
        reportHash: certificationResult.data.report_hash,
        policyVersion: certificationResult.data.policy_version,
        environment: certificationResult.data
          .environment as CertifiedRenderedEditorEvidence['environment'],
        report: certificationResult.data.report,
      }
    : {
        source: 'certification_not_required',
        artifactId: input.expectedArtifactId,
        contentHash: input.expectedContentHash,
        report: {
          certificationRequired: false,
          reason:
            'Trusted browser certification is disabled for semantic editing',
        },
      }

  const blueprint = artifactResult.data.blueprint
  const blueprintRecord =
    blueprint && typeof blueprint === 'object' && !Array.isArray(blueprint)
      ? (blueprint as Record<string, Json | undefined>)
      : {}

  return {
    website: {
      id: website.id,
      propertyId: website.property_id,
      orgId: website.org_id,
    },
    artifact: {
      id: artifactResult.data.id,
      version: artifactResult.data.version,
      contentHash: artifactResult.data.content_hash,
      blueprint,
      assetManifest: artifactResult.data.asset_manifest,
      siteConfiguration: artifactResult.data.site_configuration,
      motionConfiguration: artifactResult.data.motion_configuration,
      baseThemePackageId: artifactResult.data.base_theme_package_id,
      baseThemePackageSha256: artifactResult.data.base_theme_package_sha256,
      overlayPackageSha256: artifactResult.data.overlay_package_sha256,
      runtimeContractVersion: artifactResult.data.runtime_contract_version,
      runtimePackageSha256: artifactResult.data.runtime_package_sha256,
    },
    propertyEvidence: asJson({
      property: propertyResult.data,
      brandContext: blueprintRecord.brandContext || null,
      legal: blueprintRecord.legal || null,
      analytics: blueprintRecord.analytics || null,
    }),
    approvedAssets: asJson(assetsResult.data || []),
    revisionHistory: asJson(revisionsResult.data || []),
    wordpressCapabilities: asJson({
      artifactSchemaVersion: 2,
      semanticOperations: true,
      runtimeV2:
        runtimeTargetResult.data?.runtime_contract_version === 2 &&
        Boolean(runtimeTargetResult.data.runtime_version),
      runtime: runtimeTargetResult.data || null,
      themeOverlay: runtimeTargetResult.data?.runtime_contract_version !== 2,
      contentManifestRequired: true,
      targetTypes: ['canonical_preview', 'staging'],
    }),
    renderedEvidence,
  }
}
