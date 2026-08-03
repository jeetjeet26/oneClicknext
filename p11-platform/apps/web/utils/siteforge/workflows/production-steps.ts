import { FatalError } from 'workflow'
import type { GeneratedPage } from '@/types/siteforge'
import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { normalizeLegacyPages } from '@/utils/siteforge/blueprint'
import { CloudwaysProviderClient } from '@/utils/siteforge/providers/cloudways-provider'
import { getConfiguredDnsProvider } from '@/utils/siteforge/providers/dns-provider'
import {
  buildRenderedCertificationTruth,
  certifyRenderedWordPressArtifact,
} from '@/utils/siteforge/verification/rendered-certification'
import { getWordPressCredentialReference } from '@/utils/siteforge/wordpress/credential-vault'
import { WordPressAPIClient } from '@/utils/siteforge/wordpress-client'
import { brandForgeContractV1Schema } from '@/utils/brandforge/contracts'
import { mapWebsiteAssetRow } from '@/utils/siteforge/assets/repository'
import { loadSiteForgePublicRuntimeConfig } from '@/utils/siteforge/public-runtime'
import { validateWordPressThemeArtifact } from '@/utils/siteforge/wordpress/theme-artifact'
import {
  siteForgeAnalyticsConfigSchema,
  siteForgeLegalConfigSchema,
} from '@/utils/siteforge/quality/deterministic-gates'
import {
  getLaunchRelease,
  transitionLaunchRelease,
} from '@/utils/siteforge/launch/repository'
import { restoreLaunchRelease } from '@/utils/siteforge/launch/service'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export interface SiteForgeProductionCertificationInput {
  sharedJobId: string
  releaseId: string
  actorId: string
  deploymentId: string
  targetId: string
  websiteId: string
  propertyId: string
  orgId: string
  artifactId: string
  contentHash: string
  productionUrl: string
  startedAt: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

async function setStage(
  input: SiteForgeProductionCertificationInput,
  stage: string,
  progress: number,
  currentStep: string
) {
  const client = createServiceClient()
  const now = new Date().toISOString()
  const [{ error: jobError }, { error: deploymentError }, { error: websiteError }] =
    await Promise.all([
      client
        .from('shared_jobs')
        .update({
          lifecycle_status: 'running',
          status_reason: stage,
          stage,
          progress,
          current_step: currentStep,
          heartbeat_at: now,
          started_at: progress <= 5 ? now : undefined,
          updated_at: now,
        })
        .eq('id', input.sharedJobId)
        .eq('domain', 'siteforge.production-certification'),
      client
        .from('siteforge_artifact_deployments')
        .update({ status: 'production_certifying' })
        .eq('id', input.deploymentId)
        .eq('artifact_id', input.artifactId),
      client
        .from('property_websites')
        .update({
          editor_lifecycle_status: 'certifying_production',
          current_step: currentStep,
          updated_at: now,
        })
        .eq('id', input.websiteId)
        .eq('staging_artifact_id', input.artifactId),
    ])
  if (jobError || deploymentError || websiteError) {
    throw new Error(
      `Failed to persist production certification stage: ${
        jobError?.message || deploymentError?.message || websiteError?.message
      }`
    )
  }
}

async function assertProductionNotCancelled(
  input: SiteForgeProductionCertificationInput,
  client: ReturnType<typeof createServiceClient>
) {
  const { data: job, error } = await client
    .from('shared_jobs')
    .select('cancel_requested, lifecycle_status')
    .eq('id', input.sharedJobId)
    .single()
  if (
    error ||
    !job ||
    job.cancel_requested ||
    job.lifecycle_status === 'cancelled'
  ) {
    throw new FatalError('Production certification was cancelled')
  }
}

export async function restoreProductionProtection(
  wp: Pick<WordPressAPIClient, 'applySiteForgeSettings'>,
  input: Parameters<WordPressAPIClient['applySiteForgeSettings']>[0]
) {
  await wp.applySiteForgeSettings({
    ...input,
    targetMode: 'staging',
  })
}

export async function certifySiteForgeProduction(
  input: SiteForgeProductionCertificationInput
) {
  'use step'
  const client = createServiceClient()
  await assertProductionNotCancelled(input, client)
  await setStage(input, 'verifying_promotion', 5, 'Verifying operator-promoted artifact')
  const launchRelease = await getLaunchRelease(input.releaseId, input.propertyId, client)
  if (
    launchRelease.state !== 'promoted' ||
    launchRelease.website_id !== input.websiteId ||
    launchRelease.artifact_id !== input.artifactId ||
    launchRelease.artifact_content_hash !== input.contentHash
  ) {
    throw new FatalError('Production certification is not linked to the exact promoted launch release')
  }

  const [{ data: website, error: websiteError }, { data: artifact, error: artifactError }] =
    await Promise.all([
      client
        .from('property_websites')
        .select(
          'id, org_id, property_id, wordpress_credential_ref, target_domain, staging_artifact_id, staging_content_hash, current_artifact_version_id'
        )
        .eq('id', input.websiteId)
        .eq('org_id', input.orgId)
        .eq('property_id', input.propertyId)
        .single(),
      client
        .from('siteforge_blueprint_versions')
        .select('id, website_id, content_hash, blueprint')
        .eq('id', input.artifactId)
        .eq('website_id', input.websiteId)
        .single(),
    ])
  if (websiteError || !website || artifactError || !artifact) {
    throw new FatalError(
      `Production certification identity is unavailable: ${
        websiteError?.message || artifactError?.message || input.websiteId
      }`
    )
  }
  if (
    website.current_artifact_version_id !== input.artifactId ||
    website.staging_artifact_id !== input.artifactId ||
    website.staging_content_hash !== input.contentHash ||
    artifact.content_hash !== input.contentHash
  ) {
    throw new FatalError('Production promotion no longer matches the exact staged artifact')
  }
  if (!website.wordpress_credential_ref) {
    throw new FatalError('Production WordPress credentials are unavailable')
  }

  const credentials = await getWordPressCredentialReference(
    website.wordpress_credential_ref
  )
  const blueprint = asRecord(artifact.blueprint)
  const themeArtifact = validateWordPressThemeArtifact(
    blueprint.wordpressThemeArtifact
  )
  const legal = siteForgeLegalConfigSchema.parse(blueprint.legal)
  const analytics = siteForgeAnalyticsConfigSchema.parse(blueprint.analytics)
  const brandContractResult = brandForgeContractV1Schema.safeParse(
    asRecord(blueprint.brandSnapshot).contract,
  )
  const pages = normalizeLegacyPages(
    Array.isArray(blueprint.pages)
      ? (blueprint.pages as unknown as GeneratedPage[])
      : []
  )
  if (!pages.length) throw new FatalError('Production artifact has no pages to certify')
  const { data: assetRows, error: assetError } = await client
    .from('website_assets')
    .select('*')
    .eq('website_id', input.websiteId)
  if (assetError) throw new Error(`Failed to load production asset manifest: ${assetError.message}`)
  const approvedImageUrls = (assetRows || [])
    .map(mapWebsiteAssetRow)
    .map(asset => asset.fileUrl)
  const publicRuntime = await loadSiteForgePublicRuntimeConfig(
    input.websiteId,
    input.propertyId,
    client,
  )
  const certificationTruth = buildRenderedCertificationTruth(
    blueprint.propertySnapshot,
    approvedImageUrls,
    publicRuntime.conversionEndpoint,
  )

  if (website.target_domain) {
    await setStage(input, 'attaching_domain', 20, 'Attaching and verifying production DNS')
    if (
      credentials.provider !== 'cloudways' ||
      !credentials.providerMetadata ||
      !process.env.CLOUDWAYS_API_KEY ||
      !process.env.CLOUDWAYS_EMAIL
    ) {
      throw new FatalError('Cloudways metadata is required to attach the production domain')
    }
    const dns = getConfiguredDnsProvider()
    if (!dns) throw new FatalError('A DNS provider is required for production activation')
    const dnsRecord = await dns.upsertAddressRecord({
      hostname: website.target_domain,
      address: credentials.providerMetadata.publicIp,
    })
    const cloudways = new CloudwaysProviderClient({
      apiKey: process.env.CLOUDWAYS_API_KEY,
      email: process.env.CLOUDWAYS_EMAIL,
    })
    await cloudways.configureApplicationDomain({
      applicationId: credentials.providerMetadata.applicationId,
      domain: website.target_domain,
    })
    await cloudways.verifyDns(website.target_domain)
    const { error } = await client
      .from('property_websites')
      .update({
        domain_status: 'pending_dns',
        ssl_status: 'pending',
        dns_record_id: dnsRecord.recordId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.websiteId)
    if (error) throw new Error(`Failed to persist production DNS state: ${error.message}`)
  }

  const wp = new WordPressAPIClient(input.productionUrl, {
    username: credentials.username,
    password: credentials.password,
  })
  await wp.verifyReadiness({
    timeoutMs: Number(process.env.SITEFORGE_WP_READY_TIMEOUT_MS || 180_000),
    pollIntervalMs: Number(process.env.SITEFORGE_WP_READY_POLL_MS || 5_000),
    requireNamespaces: ['wp/v2', 'siteforge/v1'],
  })

  await setStage(input, 'certifying_exact_artifact', 50, 'Certifying exact production render')
  await assertProductionNotCancelled(input, client)
  const protectedCertification = await certifyRenderedWordPressArtifact({
    artifactId: input.artifactId,
    contentHash: input.contentHash,
    targetUrl: input.productionUrl,
    credentials: {
      username: credentials.username,
      password: credentials.password,
    },
    pages,
    brandContract: brandContractResult.success
      ? brandContractResult.data
      : undefined,
    ...certificationTruth,
  })
  const { error: protectedEvidenceError } = await client
    .from('siteforge_certification_evidence')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      website_id: input.websiteId,
      artifact_id: input.artifactId,
      release_id: input.releaseId,
      policy_version: protectedCertification.policyVersion,
      environment: 'production',
      status: protectedCertification.passed ? 'passed' : 'failed',
      report: protectedCertification as unknown as Json,
      evidence_manifest: {
        phase: 'protected',
        targetUrl: input.productionUrl,
        browserEvidenceHash: hashSiteForgeContent(
          protectedCertification.browser
        ),
      },
      report_hash: hashSiteForgeContent(protectedCertification),
    })
  if (protectedEvidenceError) {
    throw new Error(
      `Failed to persist protected production evidence: ${protectedEvidenceError.message}`
    )
  }
  if (!protectedCertification.passed) {
    throw new FatalError('Production render does not match the approved artifact')
  }

  await setStage(input, 'activating_indexing', 75, 'Clearing production noindex protection')
  await assertProductionNotCancelled(input, client)
  await wp.activateProduction(input.contentHash)
  let certification
  try {
    await assertProductionNotCancelled(input, client)
    certification = await certifyRenderedWordPressArtifact({
      artifactId: input.artifactId,
      contentHash: input.contentHash,
      targetUrl: input.productionUrl,
      credentials: {
        username: credentials.username,
        password: credentials.password,
      },
      pages,
      requireIndexable: true,
      brandContract: brandContractResult.success
        ? brandContractResult.data
        : undefined,
      ...certificationTruth,
    })
    const { error: publicEvidenceError } = await client
      .from('siteforge_certification_evidence')
      .insert({
        org_id: input.orgId,
        property_id: input.propertyId,
        website_id: input.websiteId,
        artifact_id: input.artifactId,
        release_id: input.releaseId,
        policy_version: certification.policyVersion,
        environment: 'production',
        status: certification.passed ? 'passed' : 'failed',
        report: certification as unknown as Json,
        evidence_manifest: {
          phase: 'public',
          targetUrl: input.productionUrl,
          browserEvidenceHash: hashSiteForgeContent(certification.browser),
        },
        report_hash: hashSiteForgeContent(certification),
      })
    if (publicEvidenceError) {
      throw new Error(
        `Failed to persist public production evidence: ${publicEvidenceError.message}`
      )
    }
    if (!certification.passed) {
      throw new FatalError('Production activation failed indexability certification')
    }
  } catch (cause) {
    try {
      await restoreProductionProtection(wp, {
        themeArtifact,
        legal,
        analytics,
        publicRuntime,
      })
    } catch (protectionError) {
      throw new FatalError(
        `Production certification failed and noindex protection could not be restored: ${
          protectionError instanceof Error
            ? protectionError.message
            : String(protectionError)
        }`
      )
    }
    throw cause
  }

  const completedAt = new Date().toISOString()
  const report = certification as unknown as Json
  const [
    { error: deploymentCompleteError },
    { error: targetCompleteError },
    { error: websiteCompleteError },
    { error: jobCompleteError },
  ] = await Promise.all([
    client
      .from('siteforge_artifact_deployments')
      .update({
        status: 'live',
        certification_report: report,
        remote_manifest_hash: input.contentHash,
        deployed_url: input.productionUrl,
        deployed_at: completedAt,
        certified_at: completedAt,
        externally_promoted_at: input.startedAt,
      })
      .eq('id', input.deploymentId)
      .eq('artifact_id', input.artifactId),
    client
      .from('siteforge_wordpress_targets')
      .update({
        protection_mode: 'public',
        status: 'ready',
        site_url: input.productionUrl,
        updated_at: completedAt,
      })
      .eq('id', input.targetId)
      .eq('target_type', 'production'),
    client
      .from('property_websites')
      .update({
        editor_lifecycle_status: 'production_live',
        production_target_id: input.targetId,
        production_artifact_id: input.artifactId,
        production_content_hash: input.contentHash,
        production_url: input.productionUrl,
        production_certified_at: completedAt,
        production_certification_report: report,
        externally_promoted_artifact_id: input.artifactId,
        externally_promoted_at: input.startedAt,
        deployed_artifact_version_id: input.artifactId,
        deployed_content_hash: input.contentHash,
        deployed_at: completedAt,
        wp_url: input.productionUrl,
        domain_status: website.target_domain ? 'attached' : 'not_configured',
        ssl_status: 'active',
        domain_configured_at: website.target_domain ? completedAt : null,
        current_step: 'Production artifact certified and indexable',
        error_message: null,
        updated_at: completedAt,
      })
      .eq('id', input.websiteId)
      .eq('staging_artifact_id', input.artifactId),
    client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'succeeded',
        status_reason: 'production_live',
        stage: 'production_live',
        progress: 100,
        current_step: 'Production artifact certified and indexable',
        output: {
          productionUrl: input.productionUrl,
          artifactId: input.artifactId,
          contentHash: input.contentHash,
          certification,
        } as unknown as Json,
        heartbeat_at: completedAt,
        finished_at: completedAt,
        updated_at: completedAt,
      })
      .eq('id', input.sharedJobId)
      .eq('domain', 'siteforge.production-certification'),
  ])
  const completionError =
    deploymentCompleteError ||
    targetCompleteError ||
    websiteCompleteError ||
    jobCompleteError
  if (completionError) {
    throw new Error(`Failed to persist production truth: ${completionError.message}`)
  }

  const { data: checkpointedRelease, error: releaseError } = await client
    .from('siteforge_launch_releases')
    .update({
      production_certification_report: report,
      production_certified_at: completedAt,
    })
    .eq('id', launchRelease.id)
    .eq('state', 'promoted')
    .eq('state_version', launchRelease.state_version)
    .select('*')
    .single()
  if (releaseError || !checkpointedRelease) {
    throw new Error('Production succeeded but launch certification could not be checkpointed')
  }
  const productionCertified = await transitionLaunchRelease(
    checkpointedRelease,
    'production_certified',
    'system',
    input.actorId,
    'Exact promoted artifact passed production certification',
    { certificationReport: report },
    input.sharedJobId,
    client
  )
  await transitionLaunchRelease(
    productionCertified,
    'live',
    'system',
    input.actorId,
    'Production certification completed and the release is live',
    {
      artifactId: input.artifactId,
      contentHash: input.contentHash,
      productionUrl: input.productionUrl,
    },
    input.sharedJobId,
    client
  )

  return {
    productionUrl: input.productionUrl,
    artifactId: input.artifactId,
    contentHash: input.contentHash,
    certification,
  }
}

certifySiteForgeProduction.maxRetries = 0

export async function failSiteForgeProductionCertification(
  input: SiteForgeProductionCertificationInput,
  message: string
) {
  'use step'
  const client = createServiceClient()
  const now = new Date().toISOString()
  await Promise.all([
    client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'failed',
        status_reason: 'production_certification_failed',
        stage: 'failed',
        current_step: 'Production certification failed',
        error_message: message,
        error_details: { message } as Json,
        finished_at: now,
        updated_at: now,
      })
      .eq('id', input.sharedJobId)
      .neq('lifecycle_status', 'cancelled'),
    client
      .from('siteforge_artifact_deployments')
      .update({
        status: 'failed',
        certification_report: { error: message } as Json,
      })
      .eq('id', input.deploymentId),
    client
      .from('property_websites')
      .update({
        editor_lifecycle_status: 'staging_ready',
        current_step: 'Production certification failed; production remains protected',
        error_message: message,
        updated_at: now,
      })
      .eq('id', input.websiteId),
  ])
  try {
    const restore = await restoreLaunchRelease(
      {
        releaseId: input.releaseId,
        propertyId: input.propertyId,
        rationale: `Automatic safety restore after post-promotion certification failure: ${message}`,
        actorId: input.actorId,
        requestId: input.sharedJobId,
      },
      client
    )
    if (restore.manualRequired) {
      const release = restore.release
      if (release.backup_id) {
        await client.from('siteforge_restore_drills').insert({
          org_id: input.orgId,
          property_id: input.propertyId,
          website_id: input.websiteId,
          release_id: release.id,
          backup_id: release.backup_id,
          expected_artifact_id: release.rollback_artifact_id || release.artifact_id,
          expected_content_hash:
            release.rollback_content_hash || release.artifact_content_hash,
          status: 'queued',
          verification_report: {
            requestType: 'automatic_safety_restore_manual_provider_fallback',
            executionRequiresOperator: true,
            reason: message,
          } as Json,
        })
      }
    }
  } catch (restoreError) {
    console.error('[siteforge_production_certification] automatic restore failed', {
      releaseId: input.releaseId,
      error: restoreError instanceof Error ? restoreError.message : String(restoreError),
    })
  }
}
