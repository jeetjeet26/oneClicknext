import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { normalizeLegacyPages } from '@/utils/siteforge/blueprint'
import { loadVerifiedSiteForgeRelease } from '@/utils/siteforge/artifacts/release'
import { buildReleaseCertificationBinding } from '@/utils/siteforge/verification/certification-binding'
import { certifyRenderedWordPressArtifact } from '@/utils/siteforge/verification/rendered-certification'
import { WordPressAPIClient } from '@/utils/siteforge/wordpress-client'
import { getWordPressCredentialReference } from '@/utils/siteforge/wordpress/credential-vault'
import { storeWordPressCredentialReference } from '@/utils/siteforge/wordpress/credential-vault'
import {
  CloudwaysProviderClient,
  parseCloudwaysApplicationHostname,
} from '@/utils/siteforge/providers/cloudways-provider'
import type { Database, Json } from '@/types/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedPage } from '@/types/siteforge'
import {
  AURORA_LIFECYCLE_DOMAIN,
  AuroraLifecycleControlError,
  type AuroraLifecycleIdentity,
} from './aurora-lifecycle-control'

type Client = SupabaseClient<Database>

function record(value: Json | null | undefined): Record<string, Json | undefined> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json | undefined>)
    : {}
}

async function previewCredentials(
  target: { credential_ref: string | null; site_url: string | null }
) {
  if (!target.site_url) {
    throw new AuroraLifecycleControlError(
      'Exact Aurora preview URL is missing',
      409,
      'preview_identity_incomplete'
    )
  }
  if (target.credential_ref?.startsWith('supabase-vault:')) {
    return getWordPressCredentialReference(target.credential_ref)
  }
  if (target.credential_ref !== 'env:SITEFORGE_PREVIEW_WP_APP_PASSWORD') {
    throw new AuroraLifecycleControlError(
      'Exact Aurora preview credential reference is unsupported',
      409,
      'preview_credentials_missing'
    )
  }
  const username = process.env.SITEFORGE_PREVIEW_WP_USERNAME?.trim()
  const password = process.env.SITEFORGE_PREVIEW_WP_APP_PASSWORD?.trim()
  if (!username || !password) {
    throw new AuroraLifecycleControlError(
      'Aurora preview credentials are unavailable',
      503,
      'preview_credentials_missing'
    )
  }
  return {
    provider: 'wordpress' as const,
    url: target.site_url,
    username,
    password,
  }
}

export async function bootstrapAuroraArtifacts(input: {
  identity: AuroraLifecycleIdentity
  actorId: string
  runtimePackageSha256: string
  runtimeManifestSha256: string
  baseThemePackageSha256: string
  runtimeSigningKeyId: string
  client: Client
}) {
  const { identity, client } = input
  const { data: lease, error: leaseError } = await client
    .from('shared_jobs')
    .select('id, output')
    .eq('domain', AURORA_LIFECYCLE_DOMAIN)
    .eq('subject_id', identity.websiteId)
    .eq('lease_owner', identity.ownerId)
    .single()
  if (leaseError || !lease) {
    throw new AuroraLifecycleControlError(
      'Owned Aurora bootstrap lease was not found',
      409,
      'lease_not_owned'
    )
  }
  const prior = record(lease.output)
  if (
    typeof prior.rollbackArtifactId === 'string' &&
    typeof prior.rollbackContentHash === 'string' &&
    typeof prior.startArtifactId === 'string' &&
    typeof prior.startContentHash === 'string'
  ) {
    if (
      prior.runtimePackageSha256 !== input.runtimePackageSha256 ||
      prior.runtimeManifestSha256 !== input.runtimeManifestSha256 ||
      prior.baseThemePackageSha256 !== input.baseThemePackageSha256
    ) {
      throw new AuroraLifecycleControlError(
        'A different immutable runtime identity is already bound to this bootstrap lease',
        409,
        'bootstrap_identity_conflict'
      )
    }
    const { error } = await client
      .from('property_websites')
      .update({
        current_artifact_version_id: prior.startArtifactId,
        current_step: 'Aurora bootstrap artifacts verified',
        updated_at: new Date().toISOString(),
      })
      .eq('id', identity.websiteId)
      .eq('property_id', identity.propertyId)
    if (error) throw new Error('Failed to reconcile Aurora start artifact')
    return {
      rollbackArtifactId: prior.rollbackArtifactId,
      rollbackContentHash: prior.rollbackContentHash,
      startArtifactId: prior.startArtifactId,
      startContentHash: prior.startContentHash,
      idempotent: true,
    }
  }

  const [
    { data: website, error: websiteError },
    { data: target, error: targetError },
    { data: runtimePackage, error: runtimeError },
    { data: themePackage, error: themeError },
  ] = await Promise.all([
    client
      .from('property_websites')
      .select('current_artifact_version_id')
      .eq('id', identity.websiteId)
      .eq('property_id', identity.propertyId)
      .single(),
    client
      .from('siteforge_wordpress_targets')
      .select(
        'id, site_url, credential_ref, last_verified_artifact_id, last_verified_content_hash, last_verified_asset_manifest_hash, last_verified_operation_hash'
      )
      .eq('id', identity.targetId)
      .eq('website_id', identity.websiteId)
      .eq('target_type', 'canonical_preview')
      .single(),
    client
      .from('siteforge_runtime_packages')
      .select(
        'package_sha256, manifest_sha256, signing_key_id, publication_status, runtime_contract_version, revoked_at'
      )
      .eq('package_type', 'runtime_plugin')
      .eq('package_sha256', input.runtimePackageSha256)
      .maybeSingle(),
    client
      .from('siteforge_runtime_packages')
      .select('package_sha256, publication_status, revoked_at')
      .eq('package_type', 'base_theme')
      .eq('package_sha256', input.baseThemePackageSha256)
      .maybeSingle(),
  ])
  if (
    websiteError ||
    !website?.current_artifact_version_id ||
    targetError ||
    !target
  ) {
    throw new AuroraLifecycleControlError(
      'Exact Aurora preview and current artifact are required',
      409,
      'bootstrap_source_missing'
    )
  }
  if (
    runtimeError ||
    !runtimePackage ||
    runtimePackage.runtime_contract_version !== 3 ||
    runtimePackage.manifest_sha256 !== input.runtimeManifestSha256 ||
    runtimePackage.signing_key_id !== input.runtimeSigningKeyId ||
    runtimePackage.publication_status !== 'published' ||
    runtimePackage.revoked_at
  ) {
    throw new AuroraLifecycleControlError(
      'Published signed runtime v3 package identity was not found',
      409,
      'runtime_package_unverified'
    )
  }
  if (
    themeError ||
    !themePackage ||
    themePackage.publication_status !== 'published' ||
    themePackage.revoked_at
  ) {
    throw new AuroraLifecycleControlError(
      'Published base theme package identity was not found',
      409,
      'base_theme_unverified'
    )
  }

  const { data: source, error: sourceError } = await client
    .from('siteforge_blueprint_versions')
    .select(
      'id, version, org_id, property_id, website_id, blueprint, content_hash, asset_manifest, asset_manifest_hash, base_theme_package_id, base_theme_package_sha256, theme_overlay_id, overlay_package_sha256, site_configuration, motion_configuration, runtime_contract_version, operation_set, operation_set_hash, remote_verification_report, remote_verified_url, remote_verified_at'
    )
    .eq('id', website.current_artifact_version_id)
    .eq('website_id', identity.websiteId)
    .eq('property_id', identity.propertyId)
    .single()
  if (
    sourceError ||
    !source ||
    ![1, 2].includes(source.runtime_contract_version) ||
    !source.asset_manifest_hash ||
    !source.operation_set_hash ||
    hashSiteForgeContent(source.blueprint) !== source.content_hash ||
    hashSiteForgeContent(source.asset_manifest) !== source.asset_manifest_hash ||
    hashSiteForgeContent(source.operation_set) !== source.operation_set_hash
  ) {
    throw new AuroraLifecycleControlError(
      'Current Aurora contract-1/2 artifact is incomplete or mutable',
      409,
      'rollback_source_unverified'
    )
  }

  const credentials = await previewCredentials(target)
  const wordpress = new WordPressAPIClient(target.site_url!, {
    username: credentials.username,
    password: credentials.password,
  })
  const manifest = await wordpress.getContentManifest()
  if (manifest.content_hash !== source.content_hash) {
    throw new AuroraLifecycleControlError(
      'Aurora WordPress readback does not match the current immutable artifact',
      409,
      'remote_baseline_mismatch'
    )
  }
  const release = await loadVerifiedSiteForgeRelease(
    {
      artifactId: source.id,
      websiteId: identity.websiteId,
      propertyId: identity.propertyId,
      orgId: source.org_id,
      contentHash: source.content_hash,
    },
    client
  )
  const blueprint = record(source.blueprint)
  const pages = normalizeLegacyPages(
    Array.isArray(blueprint.pages)
      ? (blueprint.pages as unknown as GeneratedPage[])
      : []
  )
  if (!pages.length) {
    throw new AuroraLifecycleControlError(
      'Aurora rollback source has no certifiable pages',
      409,
      'rollback_source_unverified'
    )
  }
  const certification = await certifyRenderedWordPressArtifact({
    artifactId: source.id,
    contentHash: source.content_hash,
    artifactBinding: buildReleaseCertificationBinding(release),
    targetUrl: target.site_url!,
    credentials: {
      username: credentials.username,
      password: credentials.password,
    },
    pages,
    environment: 'protected_preview',
    access: 'protected',
    requireIndexable: false,
  })
  if (!certification.passed) {
    const failedChecks = certification.checks
      .filter(check => !check.passed)
      .map(check => ({ code: check.code, evidence: check.evidence }))
    throw new AuroraLifecycleControlError(
      `Protected Aurora rollback certification failed: ${JSON.stringify(failedChecks)}`,
      409,
      'rollback_certification_failed'
    )
  }

  const now = new Date().toISOString()
  const deploymentKey = `aurora-bootstrap:${identity.ownerId}:${source.id}`
  const { data: existingDeployment } = await client
    .from('siteforge_artifact_deployments')
    .select('id')
    .eq('deployment_idempotency_key', deploymentKey)
    .maybeSingle()
  let deploymentId = existingDeployment?.id
  if (!deploymentId) {
    const { data: deployment, error: deploymentError } = await client
      .from('siteforge_artifact_deployments')
      .insert({
        org_id: source.org_id,
        property_id: identity.propertyId,
        website_id: identity.websiteId,
        target_id: identity.targetId,
        artifact_id: source.id,
        artifact_content_hash: source.content_hash,
        asset_manifest_hash: source.asset_manifest_hash,
        base_theme_package_sha256: source.base_theme_package_sha256!,
        overlay_package_sha256: source.overlay_package_sha256,
        shared_job_id: lease.id,
        status: 'live',
        remote_manifest_hash: source.content_hash,
        certification_report: certification as unknown as Json,
        deployed_url: target.site_url,
        deployed_at: now,
        certified_at: now,
        runtime_contract_version: source.runtime_contract_version,
        operation_set_hash: source.operation_set_hash,
        final_verified_content_hash: source.content_hash,
        final_verified_asset_manifest_hash: source.asset_manifest_hash,
        deployment_idempotency_key: deploymentKey,
      })
      .select('id')
      .single()
    if (deploymentError || !deployment) {
      throw new Error('Failed to persist Aurora rollback certification')
    }
    deploymentId = deployment.id
  }
  const [artifactReadback, targetReadback] = await Promise.all([
    client
      .from('siteforge_blueprint_versions')
      .update({
        remote_verification_report: certification as unknown as Json,
        remote_verified_url: target.site_url,
        remote_verified_at: now,
      })
      .eq('id', source.id)
      .eq('website_id', identity.websiteId),
    client
      .from('siteforge_wordpress_targets')
      .update({
        last_verified_artifact_id: source.id,
        last_verified_content_hash: source.content_hash,
        last_verified_asset_manifest_hash: source.asset_manifest_hash,
        last_verified_operation_hash: source.operation_set_hash,
        updated_at: now,
      })
      .eq('id', identity.targetId)
      .eq('website_id', identity.websiteId),
  ])
  if (artifactReadback.error || targetReadback.error) {
    throw new Error('Failed to persist Aurora rollback readback identity')
  }

  const operationSet = [
    ...(Array.isArray(source.operation_set) ? source.operation_set : []),
    {
      op: 'runtime.v3.derive',
      sourceArtifactId: source.id,
      lifecycleOwnerId: identity.ownerId,
    },
  ] as Json[]
  const { data: existingStart } = await client
    .from('siteforge_blueprint_versions')
    .select('id, content_hash')
    .eq('shared_job_id', lease.id)
    .eq('runtime_contract_version', 3)
    .eq('runtime_package_sha256', input.runtimePackageSha256)
    .maybeSingle()
  let startArtifact = existingStart
  if (!startArtifact) {
    const { data: created, error: createError } = await client
      .from('siteforge_blueprint_versions')
      .insert({
        website_id: identity.websiteId,
        version: source.version + 1,
        blueprint: source.blueprint,
        created_by: input.actorId,
        org_id: source.org_id,
        property_id: identity.propertyId,
        blueprint_schema_version: 1,
        content_hash: source.content_hash,
        parent_version_id: source.id,
        change_type: 'runtime_upgrade',
        changes_summary: 'Derived immutable Aurora runtime v3 start artifact',
        edit_intent: 'Bind certified rollback content to published runtime v3 without WordPress mutation',
        patches_applied: {
          lifecycleOwnerId: identity.ownerId,
          sourceArtifactId: source.id,
          runtimeManifestSha256: input.runtimeManifestSha256,
        },
        shared_job_id: lease.id,
        quality_report: { bootstrapDerived: true },
        quality_score: 1,
        asset_manifest: source.asset_manifest,
        asset_manifest_hash: source.asset_manifest_hash,
        base_theme_package_id: source.base_theme_package_id,
        base_theme_package_sha256: input.baseThemePackageSha256,
        theme_overlay_id: source.theme_overlay_id,
        overlay_package_sha256: source.overlay_package_sha256,
        site_configuration: source.site_configuration,
        motion_configuration: source.motion_configuration,
        runtime_contract_version: 3,
        runtime_package_sha256: input.runtimePackageSha256,
        operation_set: operationSet as unknown as Json,
        operation_set_hash: hashSiteForgeContent(operationSet),
      })
      .select('id, content_hash')
      .single()
    if (createError || !created) {
      throw new Error('Failed to derive immutable Aurora runtime v3 start artifact')
    }
    startArtifact = created
  }

  const [websiteProjection, leaseProjection] = await Promise.all([
    client
      .from('property_websites')
      .update({
        current_artifact_version_id: startArtifact.id,
        current_step: 'Aurora bootstrap artifacts verified',
        updated_at: now,
      })
      .eq('id', identity.websiteId)
      .eq('property_id', identity.propertyId),
    client.from('shared_jobs').update({
      output: {
        ...prior,
        phase: 'bootstrap',
        baselineImported: true,
        rollbackArtifactId: source.id,
        rollbackContentHash: source.content_hash,
        rollbackDeploymentId: deploymentId,
        rollbackCertifiedAt: now,
        rollbackSourcePrior: {
          remoteVerificationReport: source.remote_verification_report,
          remoteVerifiedUrl: source.remote_verified_url,
          remoteVerifiedAt: source.remote_verified_at,
        },
        anchorTargetPrior: {
          lastVerifiedArtifactId: target.last_verified_artifact_id,
          lastVerifiedContentHash: target.last_verified_content_hash,
          lastVerifiedAssetManifestHash:
            target.last_verified_asset_manifest_hash,
          lastVerifiedOperationHash: target.last_verified_operation_hash,
        },
        startArtifactId: startArtifact.id,
        startContentHash: startArtifact.content_hash,
        runtimePackageSha256: input.runtimePackageSha256,
        runtimeManifestSha256: input.runtimeManifestSha256,
        baseThemePackageSha256: input.baseThemePackageSha256,
        ownedResources: [
          ...((Array.isArray(prior.ownedResources)
            ? prior.ownedResources
            : []) as Json[]),
          { kind: 'artifact', id: startArtifact.id },
          { kind: 'artifact_deployment', id: deploymentId },
        ],
      },
      updated_at: now,
    })
    .eq('id', lease.id)
    .eq('lease_owner', identity.ownerId),
  ])
  if (websiteProjection.error || leaseProjection.error) {
    throw new Error('Failed to persist Aurora bootstrap artifacts')
  }

  return {
    rollbackArtifactId: source.id,
    rollbackContentHash: source.content_hash,
    startArtifactId: startArtifact.id,
    startContentHash: startArtifact.content_hash,
    idempotent: false,
  }
}

export async function provisionAuroraTargets(input: {
  identity: AuroraLifecycleIdentity
  actorId: string
  stagingApplicationId: string
  stagingOperationId: string
  client: Client
}) {
  const { identity, client } = input
  const { data: lease, error: leaseError } = await client
    .from('shared_jobs')
    .select('id, output')
    .eq('domain', AURORA_LIFECYCLE_DOMAIN)
    .eq('subject_id', identity.websiteId)
    .eq('lease_owner', identity.ownerId)
    .single()
  if (leaseError || !lease) {
    throw new AuroraLifecycleControlError(
      'Owned Aurora bootstrap lease was not found',
      409,
      'lease_not_owned'
    )
  }
  const prior = record(lease.output)
  if (
    typeof prior.productionTargetId === 'string' &&
    typeof prior.stagingTargetId === 'string'
  ) {
    if (
      prior.stagingApplicationId !== input.stagingApplicationId ||
      prior.stagingProvisionOperationId !== input.stagingOperationId
    ) {
      throw new AuroraLifecycleControlError(
        'A different Cloudways staging identity is already bound to this lease',
        409,
        'provider_operation_conflict'
      )
    }
    return {
      productionTargetId: prior.productionTargetId,
      stagingTargetId: prior.stagingTargetId,
      idempotent: true,
    }
  }
  const { data: reconciledTargets, error: reconciledTargetsError } = await client
    .from('siteforge_wordpress_targets')
    .select('id, target_type, provider_application_id, metadata')
    .eq('website_id', identity.websiteId)
    .contains('metadata', {
      lifecycleOwnerId: identity.ownerId,
      lifecycleRunId: identity.ownerId,
    })
    .in('target_type', ['staging', 'production'])
  if (reconciledTargetsError) {
    throw new Error('Failed to reconcile Aurora target provisioning')
  }
  const reconciledProduction = reconciledTargets?.find(
    target => target.target_type === 'production'
  )
  const reconciledStaging = reconciledTargets?.find(
    target => target.target_type === 'staging'
  )
  if (reconciledProduction && reconciledStaging) {
    const stagingMetadata = record(reconciledStaging.metadata)
    if (
      reconciledStaging.provider_application_id !==
        input.stagingApplicationId ||
      stagingMetadata.stagingProvisionOperationId !== input.stagingOperationId
    ) {
      throw new AuroraLifecycleControlError(
        'Owned Aurora targets do not match the requested Cloudways identity',
        409,
        'provider_operation_conflict'
      )
    }
    const { data: reconciledRollouts, error: rolloutError } = await client
      .from('siteforge_runtime_target_rollouts')
      .select('id, target_id, status, requested_contract_version')
      .in('target_id', [reconciledProduction.id, reconciledStaging.id])
      .eq('website_id', identity.websiteId)
    const productionRollout = reconciledRollouts?.find(
      rollout =>
        rollout.target_id === reconciledProduction.id &&
        rollout.status === 'paused' &&
        rollout.requested_contract_version === 3
    )
    const stagingRollout = reconciledRollouts?.find(
      rollout =>
        rollout.target_id === reconciledStaging.id &&
        rollout.status === 'paused' &&
        rollout.requested_contract_version === 3
    )
    if (rolloutError || !productionRollout || !stagingRollout) {
      throw new AuroraLifecycleControlError(
        'Partial Aurora runtime assignment provisioning requires cleanup',
        409,
        'provider_reconciliation_required'
      )
    }
    const { error } = await client
      .from('shared_jobs')
      .update({
        output: {
          ...prior,
          productionTargetId: reconciledProduction.id,
          stagingTargetId: reconciledStaging.id,
          productionRolloutId: productionRollout.id,
          stagingRolloutId: stagingRollout.id,
          stagingApplicationId: input.stagingApplicationId,
          stagingProvisionOperationId: input.stagingOperationId,
          ownedResources: [
            ...((Array.isArray(prior.ownedResources)
              ? prior.ownedResources
              : []) as Json[]),
            { kind: 'target', id: reconciledProduction.id },
            { kind: 'target', id: reconciledStaging.id },
            { kind: 'rollout', id: productionRollout.id },
            { kind: 'rollout', id: stagingRollout.id },
          ],
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', lease.id)
      .eq('lease_owner', identity.ownerId)
    if (error) throw new Error('Failed to reconcile Aurora target ownership')
    return {
      productionTargetId: reconciledProduction.id,
      stagingTargetId: reconciledStaging.id,
      idempotent: true,
    }
  }
  if (reconciledProduction || reconciledStaging) {
    throw new AuroraLifecycleControlError(
      'Partial Aurora target provisioning requires owned-resource cleanup before retry',
      409,
      'provider_reconciliation_required'
    )
  }
  if (
    typeof prior.rollbackArtifactId !== 'string' ||
    typeof prior.startArtifactId !== 'string'
  ) {
    throw new AuroraLifecycleControlError(
      'Aurora baseline and v3 start artifact must be verified first',
      409,
      'bootstrap_baseline_missing'
    )
  }
  const apiKey = process.env.CLOUDWAYS_API_KEY?.trim()
  const email = process.env.CLOUDWAYS_EMAIL?.trim()
  if (!apiKey || !email) {
    throw new AuroraLifecycleControlError(
      'Cloudways API credentials are unavailable',
      503,
      'provider_unavailable'
    )
  }
  const { data: anchor, error: anchorError } = await client
    .from('siteforge_wordpress_targets')
    .select('site_url, org_id, property_id, website_id')
    .eq('id', identity.targetId)
    .eq('website_id', identity.websiteId)
    .eq('target_type', 'canonical_preview')
    .single()
  const providerIdentity = anchor?.site_url
    ? parseCloudwaysApplicationHostname(anchor.site_url)
    : null
  if (
    anchorError ||
    !anchor ||
    !providerIdentity ||
    anchor.property_id !== identity.propertyId
  ) {
    throw new AuroraLifecycleControlError(
      'Exact Aurora Cloudways preview identity could not be derived',
      409,
      'provider_identity_missing'
    )
  }
  const cloudways = new CloudwaysProviderClient({ apiKey, email })
  await cloudways.verifyOperation(input.stagingOperationId, {
    kind: 'staging',
    serverId: providerIdentity.serverId,
    applicationId: input.stagingApplicationId,
    parentApplicationId: providerIdentity.applicationId,
  })
  const [productionApplication, stagingApplication] = await Promise.all([
    cloudways.getApplication({
      serverId: providerIdentity.serverId,
      applicationId: providerIdentity.applicationId,
    }),
    cloudways.getApplication({
      serverId: providerIdentity.serverId,
      applicationId: input.stagingApplicationId,
    }),
  ])
  const productionUrl = /^https?:\/\//.test(productionApplication.app_fqdn)
    ? productionApplication.app_fqdn
    : `https://${productionApplication.app_fqdn}`
  const stagingUrl = /^https?:\/\//.test(stagingApplication.app_fqdn)
    ? stagingApplication.app_fqdn
    : `https://${stagingApplication.app_fqdn}`
  const productionCredentialRef = await storeWordPressCredentialReference({
    websiteId: identity.websiteId,
    secretName: `${identity.websiteId}:aurora-production:${identity.ownerId}`,
    description: 'Aurora lifecycle exact Cloudways production credential',
    credentials: {
      provider: 'cloudways',
      url: productionUrl,
      username: productionApplication.app_user,
      password: productionApplication.app_password,
      ssh: {
        host: productionApplication.public_ip || providerIdentity.serverId,
        port: 22,
        username: productionApplication.app_user,
        password: productionApplication.app_password,
        applicationRoot: 'public_html',
      },
      providerMetadata: {
        provider: 'cloudways',
        serverId: providerIdentity.serverId,
        applicationId: providerIdentity.applicationId,
        publicIp: productionApplication.public_ip || providerIdentity.serverId,
      },
    },
  })
  const stagingCredentialRef = await storeWordPressCredentialReference({
    websiteId: identity.websiteId,
    linkWebsite: false,
    secretName: `${identity.websiteId}:aurora-staging:${identity.ownerId}`,
    description: 'Aurora lifecycle exact Cloudways staging credential',
    credentials: {
      provider: 'cloudways',
      url: stagingUrl,
      username: stagingApplication.app_user,
      password: stagingApplication.app_password,
      ssh: {
        host: stagingApplication.public_ip || providerIdentity.serverId,
        port: 22,
        username: stagingApplication.app_user,
        password: stagingApplication.app_password,
        applicationRoot: 'public_html',
      },
      providerMetadata: {
        provider: 'cloudways',
        serverId: providerIdentity.serverId,
        applicationId: input.stagingApplicationId,
        publicIp: stagingApplication.public_ip || providerIdentity.serverId,
      },
    },
  })
  const now = new Date().toISOString()
  const ownedMetadata = {
    lifecycleOwnerId: identity.ownerId,
    lifecycleRunId: identity.ownerId,
    lifecycleExpiresAt: identity.expiresAt,
    bootstrapAnchorTargetId: identity.targetId,
    stagingProvisionOperationId: input.stagingOperationId,
  }
  const { data: productionTarget, error: productionError } = await client
    .from('siteforge_wordpress_targets')
    .insert({
      org_id: anchor.org_id,
      property_id: identity.propertyId,
      website_id: identity.websiteId,
      target_type: 'production',
      provider: 'cloudways',
      provider_application_id: providerIdentity.applicationId,
      provider_server_id: providerIdentity.serverId,
      site_url: productionUrl,
      admin_url: `${productionUrl.replace(/\/$/, '')}/wp-admin`,
      credential_ref: productionCredentialRef,
      protection_mode: 'protected',
      status: 'ready',
      is_active: true,
      metadata: ownedMetadata,
      runtime_contract_version: 1,
    })
    .select('id')
    .single()
  if (productionError || !productionTarget) {
    throw new Error('Failed to persist dedicated Aurora production target')
  }
  const { data: stagingTarget, error: stagingError } = await client
    .from('siteforge_wordpress_targets')
    .insert({
      org_id: anchor.org_id,
      property_id: identity.propertyId,
      website_id: identity.websiteId,
      target_type: 'staging',
      provider: 'cloudways',
      provider_application_id: input.stagingApplicationId,
      provider_parent_application_id: providerIdentity.applicationId,
      provider_server_id: providerIdentity.serverId,
      site_url: stagingUrl,
      admin_url: `${stagingUrl.replace(/\/$/, '')}/wp-admin`,
      credential_ref: stagingCredentialRef,
      protection_mode: 'protected',
      status: 'ready',
      is_active: true,
      metadata: ownedMetadata,
      runtime_contract_version: 1,
    })
    .select('id')
    .single()
  if (stagingError || !stagingTarget) {
    await client
      .from('siteforge_wordpress_targets')
      .delete()
      .eq('id', productionTarget.id)
    throw new Error('Failed to persist dedicated Aurora staging target')
  }
  const runtimeHash =
    typeof prior.runtimePackageSha256 === 'string'
      ? prior.runtimePackageSha256
      : null
  if (!runtimeHash) {
    throw new AuroraLifecycleControlError(
      'Aurora runtime package identity is missing',
      409,
      'runtime_package_unverified'
    )
  }
  const rolloutRows = [productionTarget.id, stagingTarget.id].map(targetId => ({
    org_id: anchor.org_id,
    property_id: identity.propertyId,
    website_id: identity.websiteId,
    target_id: targetId,
    requested_contract_version: 3,
    runtime_package_sha256: runtimeHash,
    status: 'paused',
    previous_runtime_contract_version: 1,
    reason: 'Aurora bootstrap waits for certified baseline and verified backup',
    assigned_by: input.actorId,
  }))
  const { data: rollouts, error: rolloutError } = await client
    .from('siteforge_runtime_target_rollouts')
    .insert(rolloutRows)
    .select('id, target_id')
  if (rolloutError || !rollouts || rollouts.length !== 2) {
    throw new Error('Failed to persist paused Aurora runtime assignments')
  }
  const { error: websiteError } = await client
    .from('property_websites')
    .update({
      production_target_id: productionTarget.id,
      production_url: productionUrl,
      staging_target_id: stagingTarget.id,
      staging_url: stagingUrl,
      staging_admin_url: `${stagingUrl.replace(/\/$/, '')}/wp-admin`,
      updated_at: now,
    })
    .eq('id', identity.websiteId)
    .eq('property_id', identity.propertyId)
  if (websiteError) throw new Error('Failed to project Aurora targets')
  const { error: leaseUpdateError } = await client
    .from('shared_jobs')
    .update({
      output: {
        ...prior,
        productionTargetId: productionTarget.id,
        stagingTargetId: stagingTarget.id,
        productionRolloutId: rollouts.find(
          row => row.target_id === productionTarget.id
        )?.id,
        stagingRolloutId: rollouts.find(
          row => row.target_id === stagingTarget.id
        )?.id,
        stagingProvisionOperationId: input.stagingOperationId,
        stagingApplicationId: input.stagingApplicationId,
        ownedResources: [
          ...((Array.isArray(prior.ownedResources)
            ? prior.ownedResources
            : []) as Json[]),
          { kind: 'target', id: productionTarget.id },
          { kind: 'target', id: stagingTarget.id },
          ...rollouts.map(row => ({ kind: 'rollout', id: row.id })),
        ],
      },
      updated_at: now,
    })
    .eq('id', lease.id)
    .eq('lease_owner', identity.ownerId)
  if (leaseUpdateError) throw new Error('Failed to register Aurora targets')
  return {
    productionTargetId: productionTarget.id,
    stagingTargetId: stagingTarget.id,
    idempotent: false,
  }
}
