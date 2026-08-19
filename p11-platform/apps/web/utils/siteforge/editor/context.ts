import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, Tables } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  isSiteForgeRuntimeBackedContractVersion,
  parseSiteForgeRuntimeContractVersion,
} from '@/utils/siteforge/runtime-dispatcher'

export interface CertifiedRenderedEditorEvidence {
  source: 'server_certification'
  certificationId: string
  artifactId: string
  reportHash: string
  policyVersion: string
  environment: 'preview' | 'staging' | 'production'
  status: 'passed' | 'failed'
  report: Json
}

export interface HistoricalRenderedEditorEvidence {
  source: 'ancestor_certification'
  certificationId: string
  artifactId: string
  reportHash: string
  policyVersion: string
  environment: 'preview' | 'staging' | 'production'
  status: 'passed' | 'failed'
  report: Json
}

export interface UncertifiedRenderedEditorEvidence {
  source: 'certification_not_required' | 'certification_unavailable'
  artifactId: string
  contentHash: string
  report: Json
}

export type RenderedEditorEvidence =
  | CertifiedRenderedEditorEvidence
  | HistoricalRenderedEditorEvidence
  | UncertifiedRenderedEditorEvidence

export class SiteForgeEditorContextError extends Error {
  constructor(
    public readonly code:
      | 'website_not_found'
      | 'artifact_version_conflict'
      | 'artifact_not_found'
      | 'artifact_hash_conflict',
    message: string
  ) {
    super(message)
    this.name = 'SiteForgeEditorContextError'
  }
}

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
  conversationHistory: Json
  wordpressCapabilities: Json
  renderedEvidence: RenderedEditorEvidence
  visualAttachments: Tables<'siteforge_edit_attachments'>[]
}

function asJson(value: unknown): Json {
  return value as Json
}

type CertificationEvidenceRow = Pick<
  Tables<'siteforge_certification_evidence'>,
  | 'id'
  | 'artifact_id'
  | 'policy_version'
  | 'environment'
  | 'status'
  | 'report_hash'
  | 'report'
>

export function selectRenderedEditorEvidence(input: {
  certifications: CertificationEvidenceRow[]
  revisionIds: string[]
  currentArtifactId: string
  currentContentHash: string
  certificationRequired: boolean
  lookupFailed?: boolean
}): RenderedEditorEvidence {
  const revisionIds = new Set(input.revisionIds)
  const certifications = input.certifications.filter((certification) =>
    revisionIds.has(certification.artifact_id)
  )
  const currentCertification = certifications.find(
    (certification) => certification.artifact_id === input.currentArtifactId
  )
  const selectedCertification =
    currentCertification || certifications[0] || null
  if (
    selectedCertification &&
    !['preview', 'staging', 'production'].includes(
      selectedCertification.environment
    )
  ) {
    throw new Error('Rendered certification environment is invalid')
  }
  if (selectedCertification) {
    return {
      source: currentCertification
        ? 'server_certification'
        : 'ancestor_certification',
      certificationId: selectedCertification.id,
      artifactId: selectedCertification.artifact_id,
      reportHash: selectedCertification.report_hash,
      policyVersion: selectedCertification.policy_version,
      environment:
        selectedCertification.environment as CertifiedRenderedEditorEvidence['environment'],
      status:
        selectedCertification.status as CertifiedRenderedEditorEvidence['status'],
      report: selectedCertification.report,
    }
  }
  return {
    source: input.certificationRequired
      ? 'certification_unavailable'
      : 'certification_not_required',
    artifactId: input.currentArtifactId,
    contentHash: input.currentContentHash,
    report: {
      certificationRequired: input.certificationRequired,
      reason: input.lookupFailed
        ? 'Optional browser QA evidence is temporarily unavailable; editing and human-approved deployment remain available'
        : input.certificationRequired
          ? 'This draft has no rendered evidence yet; editing may continue, but approval and deployment remain blocked until exact certification passes'
          : 'Full browser QA is optional and has not been run for this artifact',
    },
  }
}

export async function buildSiteForgeEditorSnapshot(
  input: {
    websiteId: string
    sessionId: string
    userMessageId?: string
    attachmentIds?: string[]
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
    throw new SiteForgeEditorContextError(
      'website_not_found',
      `Editor website not found: ${websiteError?.message || input.websiteId}`
    )
  }
  if (website.current_artifact_version_id !== input.expectedArtifactId) {
    throw new SiteForgeEditorContextError(
      'artifact_version_conflict',
      'SiteForge artifact version conflict; reload the editor and retry against the current revision'
    )
  }

  const [
    artifactResult,
    propertyResult,
    assetsResult,
    revisionsResult,
    messagesResult,
    certificationResult,
    runtimeTargetResult,
    attachmentsResult,
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
      .from('siteforge_edit_messages')
      .select(
        'id, role, status, content, failure_code, resulting_artifact_id, created_at'
      )
      .eq('session_id', input.sessionId)
      .order('created_at', { ascending: false })
      .limit(12),
    client
      .from('siteforge_certification_evidence')
      .select(
        'id, artifact_id, policy_version, environment, status, report_hash, report'
      )
      .eq('website_id', website.id)
      .order('created_at', { ascending: false })
      .limit(20),
    client
      .from('siteforge_wordpress_targets')
      .select(
        'id, runtime_contract_version, runtime_version, runtime_package_sha256, last_verified_content_hash, last_runtime_health_at'
      )
      .eq('website_id', website.id)
      .eq('target_type', 'canonical_preview')
      .eq('is_active', true)
      .maybeSingle(),
    client
      .from('siteforge_edit_attachments')
      .select('*')
      .eq('session_id', input.sessionId)
      .eq('website_id', input.websiteId)
      .eq('artifact_id', input.expectedArtifactId)
      .eq('artifact_content_hash', input.expectedContentHash)
      .in(
        'id',
        input.attachmentIds?.length
          ? input.attachmentIds
          : ['00000000-0000-0000-0000-000000000000']
      ),
  ])

  if (artifactResult.error || !artifactResult.data) {
    throw new SiteForgeEditorContextError(
      'artifact_not_found',
      `Editor artifact not found: ${artifactResult.error?.message || input.expectedArtifactId}`
    )
  }
  if (artifactResult.data.content_hash !== input.expectedContentHash) {
    throw new SiteForgeEditorContextError(
      'artifact_hash_conflict',
      'SiteForge artifact hash conflict; reload the editor and retry against the current revision'
    )
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
  if (messagesResult.error) {
    throw new Error(
      `Editor conversation history unavailable: ${messagesResult.error.message}`
    )
  }
  if (runtimeTargetResult.error) {
    throw new Error(
      `Editor WordPress runtime capability unavailable: ${runtimeTargetResult.error.message}`
    )
  }
  if (attachmentsResult.error) {
    throw new Error(
      `Editor visual context unavailable: ${attachmentsResult.error.message}`
    )
  }
  if (
    (input.attachmentIds?.length || 0) !==
      (attachmentsResult.data?.length || 0) ||
    (input.userMessageId &&
      (attachmentsResult.data || []).some(
        attachment => attachment.user_message_id !== input.userMessageId
      ))
  ) {
    throw new Error(
      'Editor visual context no longer matches the submitted immutable turn'
    )
  }
  const certificationRequired = false
  const renderedEvidence = selectRenderedEditorEvidence({
    certifications: certificationResult.data || [],
    revisionIds: (revisionsResult.data || []).map((revision) => revision.id),
    currentArtifactId: input.expectedArtifactId,
    currentContentHash: input.expectedContentHash,
    certificationRequired,
    lookupFailed: Boolean(certificationResult.error),
  })

  const blueprint = artifactResult.data.blueprint
  const blueprintRecord =
    blueprint && typeof blueprint === 'object' && !Array.isArray(blueprint)
      ? (blueprint as Record<string, Json | undefined>)
      : {}
  const targetRuntimeContractVersion = runtimeTargetResult.data
    ? parseSiteForgeRuntimeContractVersion(
        runtimeTargetResult.data.runtime_contract_version
      )
    : null
  const runtimeBacked =
    targetRuntimeContractVersion !== null &&
    isSiteForgeRuntimeBackedContractVersion(targetRuntimeContractVersion) &&
    Boolean(runtimeTargetResult.data?.runtime_version)

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
    conversationHistory: asJson([...(messagesResult.data || [])].reverse()),
    wordpressCapabilities: asJson({
      artifactSchemaVersion: 2,
      semanticOperations: true,
      runtimeBacked,
      runtimeV2: targetRuntimeContractVersion === 2 && runtimeBacked,
      runtimeV3: targetRuntimeContractVersion === 3 && runtimeBacked,
      runtime: runtimeTargetResult.data || null,
      themeOverlay:
        targetRuntimeContractVersion === null ||
        targetRuntimeContractVersion === 1,
      contentManifestRequired: true,
      targetTypes: ['canonical_preview', 'staging'],
    }),
    renderedEvidence,
    visualAttachments: attachmentsResult.data || [],
  }
}
