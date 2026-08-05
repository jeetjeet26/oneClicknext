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
import { loadSiteForgePublicRuntimeConfig } from '@/utils/siteforge/public-runtime'
import { loadApprovedFloorPlanSnapshot } from '@/utils/siteforge/providers/floor-plan-repository'
import { validateWordPressThemeArtifact } from '@/utils/siteforge/wordpress/theme-artifact'
import {
  siteForgeAnalyticsConfigSchema,
  siteForgeLegalConfigSchema,
} from '@/utils/siteforge/quality/deterministic-gates'
import {
  getLaunchRelease,
  transitionLaunchRelease,
} from '@/utils/siteforge/launch/repository'
import { requestLaunchRestore } from '@/utils/siteforge/launch/service'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { loadVerifiedSiteForgeRelease } from '@/utils/siteforge/artifacts/release'
import { deployArtifactBoundRuntimeV3 } from '@/utils/siteforge/workflows/runtime-deployment-v3'
import { buildReleaseCertificationBinding } from '@/utils/siteforge/verification/certification-binding'

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
  evidenceOnly?: boolean
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
  const { error: jobError } = await client
    .from('shared_jobs')
    .update({
      lifecycle_status: 'running',
      status_reason: stage,
      stage,
      progress,
      current_step: currentStep,
      heartbeat_at: now,
      lease_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      started_at: progress <= 5 ? now : undefined,
      updated_at: now,
    })
    .eq('id', input.sharedJobId)
    .eq('domain', 'siteforge.production-certification')
  if (input.evidenceOnly) {
    if (jobError) {
      throw new Error(
        `Failed to persist optional browser QA stage: ${jobError.message}`
      )
    }
    return
  }
  const [{ error: deploymentError }, { error: websiteError }] =
    await Promise.all([
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
    .select('cancel_requested, lifecycle_status, lease_owner')
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
  const leaseOwner = `siteforge-production:${input.sharedJobId}`
  if (job.lease_owner !== leaseOwner) {
    const now = new Date()
    const { data: claimed, error: claimError } = await client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'running',
        lease_owner: leaseOwner,
        lease_expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
        heartbeat_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', input.sharedJobId)
      .eq('domain', 'siteforge.production-certification')
      .in('lifecycle_status', ['queued', 'running', 'retrying'])
      .is('lease_owner', null)
      .select('id')
      .maybeSingle()
    if (claimError || !claimed) {
      throw new FatalError('Production certification is already claimed')
    }
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
  await setStage(
    input,
    'verifying_promotion',
    5,
    'Verifying operator-promoted artifact'
  )
  const launchRelease = await getLaunchRelease(
    input.releaseId,
    input.propertyId,
    client
  )
  if (
    (input.evidenceOnly
      ? launchRelease.state !== 'live'
      : launchRelease.state !== 'promoted') ||
    launchRelease.website_id !== input.websiteId ||
    launchRelease.artifact_id !== input.artifactId ||
    launchRelease.artifact_content_hash !== input.contentHash
  ) {
    throw new FatalError(
      'Production certification is not linked to the exact promoted launch release'
    )
  }

  const [
    { data: website, error: websiteError },
    { data: artifact, error: artifactError },
  ] = await Promise.all([
    client
      .from('property_websites')
      .select(
        'id, org_id, property_id, wordpress_credential_ref, target_domain, staging_artifact_id, staging_content_hash, current_artifact_version_id, production_artifact_id, production_content_hash'
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
  const projectedIdentityMatches = input.evidenceOnly
    ? website.production_artifact_id === input.artifactId &&
      website.production_content_hash === input.contentHash
    : website.current_artifact_version_id === input.artifactId &&
      website.staging_artifact_id === input.artifactId &&
      website.staging_content_hash === input.contentHash
  if (
    !projectedIdentityMatches ||
    artifact.content_hash !== input.contentHash
  ) {
    throw new FatalError(
      'Production promotion no longer matches the exact staged artifact'
    )
  }
  if (!website.wordpress_credential_ref) {
    throw new FatalError('Production WordPress credentials are unavailable')
  }

  const credentials = await getWordPressCredentialReference(
    website.wordpress_credential_ref
  )
  const release = await loadVerifiedSiteForgeRelease(input, client)
  const runtimeV3 = release.artifact.runtimeContractVersion === 3
  const { data: target, error: targetError } = await client
    .from('siteforge_wordpress_targets')
    .select('*')
    .eq('id', input.targetId)
    .eq('website_id', input.websiteId)
    .eq('target_type', 'production')
    .eq('is_active', true)
    .single()
  if (targetError || !target) {
    throw new FatalError('Exact production WordPress target is unavailable')
  }
  const blueprint = asRecord(artifact.blueprint)
  const themeArtifact = runtimeV3
    ? null
    : validateWordPressThemeArtifact(blueprint.wordpressThemeArtifact)
  const legal = runtimeV3
    ? null
    : siteForgeLegalConfigSchema.parse(blueprint.legal)
  const analytics = runtimeV3
    ? null
    : siteForgeAnalyticsConfigSchema.parse(blueprint.analytics)
  const brandContractResult = brandForgeContractV1Schema.safeParse(
    asRecord(blueprint.brandSnapshot).contract
  )
  const pages = normalizeLegacyPages(
    Array.isArray(blueprint.pages)
      ? (blueprint.pages as unknown as GeneratedPage[])
      : []
  )
  if (!pages.length)
    throw new FatalError('Production artifact has no pages to certify')
  const { data: assetRows, error: assetError } = await client
    .from('website_assets')
    .select('*')
    .eq('website_id', input.websiteId)
  if (assetError)
    throw new Error(
      `Failed to load production asset manifest: ${assetError.message}`
    )
  const floorPlanSnapshot = await loadApprovedFloorPlanSnapshot(
    input.propertyId,
    client
  )
  const approvedImageUrls = [
    ...(assetRows || []).flatMap((asset) =>
      [asset.file_url, asset.original_url].filter(
        (value): value is string => typeof value === 'string'
      )
    ),
    ...floorPlanSnapshot.rows.flatMap((row) =>
      row.imageUrl ? [row.imageUrl] : []
    ),
  ]
  const approvedImageDigests = (assetRows || []).flatMap((asset) => {
    const digest = asset.byte_sha256 || asset.content_hash
    return digest ? [digest] : []
  })
  const publicRuntime = await loadSiteForgePublicRuntimeConfig(
    input.websiteId,
    input.propertyId,
    client
  )
  const certificationTruth = buildRenderedCertificationTruth(
    blueprint.propertySnapshot,
    approvedImageUrls,
    publicRuntime.conversionEndpoint,
    approvedImageDigests
  )

  if (input.evidenceOnly) {
    await setStage(
      input,
      'running_optional_browser_qa',
      50,
      'Running optional production browser QA'
    )
    await assertProductionNotCancelled(input, client)
    const browserQa = await certifyRenderedWordPressArtifact({
      artifactId: input.artifactId,
      contentHash: input.contentHash,
      artifactBinding: buildReleaseCertificationBinding(release),
      targetUrl: input.productionUrl,
      credentials: {
        username: credentials.username,
        password: credentials.password,
      },
      pages,
      environment: 'production',
      access: 'public',
      requireIndexable: true,
      brandContract: brandContractResult.success
        ? brandContractResult.data
        : undefined,
      ...certificationTruth,
    })
    const { error: evidenceError } = await client
      .from('siteforge_certification_evidence')
      .insert({
        org_id: input.orgId,
        property_id: input.propertyId,
        website_id: input.websiteId,
        artifact_id: input.artifactId,
        release_id: input.releaseId,
        policy_version: browserQa.policyVersion,
        environment: 'production',
        status: browserQa.passed ? 'passed' : 'failed',
        report: browserQa as unknown as Json,
        evidence_manifest: {
          phase: 'optional_public_qa',
          targetUrl: input.productionUrl,
          bindingHash: browserQa.bindingHash,
          evidenceHash: browserQa.evidenceHash,
          browserEvidenceHash: hashSiteForgeContent(browserQa.browser),
        },
        binding_hash: browserQa.bindingHash,
        evidence_hash: browserQa.evidenceHash,
        report_hash: hashSiteForgeContent(browserQa),
      })
    if (evidenceError) {
      throw new Error(
        `Failed to persist optional production browser QA: ${evidenceError.message}`
      )
    }
    const finishedAt = new Date().toISOString()
    const { error: jobError } = await client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'succeeded',
        status_reason: browserQa.passed
          ? 'optional_browser_qa_passed'
          : 'optional_browser_qa_completed_with_warnings',
        stage: 'optional_browser_qa_complete',
        progress: 100,
        current_step: browserQa.passed
          ? 'Optional browser QA passed'
          : 'Optional browser QA completed with non-blocking warnings',
        output: {
          artifactId: input.artifactId,
          contentHash: input.contentHash,
          browserQaPassed: browserQa.passed,
          reportHash: hashSiteForgeContent(browserQa),
        } as Json,
        heartbeat_at: finishedAt,
        lease_owner: null,
        lease_expires_at: null,
        finished_at: finishedAt,
        updated_at: finishedAt,
      })
      .eq('id', input.sharedJobId)
      .eq('domain', 'siteforge.production-certification')
    if (jobError) {
      throw new Error(
        `Failed to complete optional production browser QA: ${jobError.message}`
      )
    }
    return browserQa
  }

  if (website.target_domain) {
    await setStage(
      input,
      'attaching_domain',
      20,
      'Attaching and verifying production DNS'
    )
    if (
      credentials.provider !== 'cloudways' ||
      !credentials.providerMetadata ||
      !process.env.CLOUDWAYS_API_KEY ||
      !process.env.CLOUDWAYS_EMAIL
    ) {
      throw new FatalError(
        'Cloudways metadata is required to attach the production domain'
      )
    }
    const dns = getConfiguredDnsProvider()
    if (!dns)
      throw new FatalError(
        'A DNS provider is required for production activation'
      )
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
    if (error)
      throw new Error(
        `Failed to persist production DNS state: ${error.message}`
      )
  }

  const wp = runtimeV3
    ? null
    : new WordPressAPIClient(input.productionUrl, {
        username: credentials.username,
        password: credentials.password,
      })
  if (wp) {
    await wp.verifyReadiness({
      timeoutMs: Number(process.env.SITEFORGE_WP_READY_TIMEOUT_MS || 180_000),
      pollIntervalMs: Number(process.env.SITEFORGE_WP_READY_POLL_MS || 5_000),
      requireNamespaces: ['wp/v2', 'siteforge/v1'],
    })
  }

  await setStage(
    input,
    'certifying_exact_artifact',
    50,
    'Certifying exact production render'
  )
  await assertProductionNotCancelled(input, client)
  const protectedCertification = await certifyRenderedWordPressArtifact({
    artifactId: input.artifactId,
    contentHash: input.contentHash,
    artifactBinding: buildReleaseCertificationBinding(release),
    targetUrl: input.productionUrl,
    credentials: {
      username: credentials.username,
      password: credentials.password,
    },
    pages,
    environment: 'production',
    access: 'protected',
    requireIndexable: false,
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
        bindingHash: protectedCertification.bindingHash,
        evidenceHash: protectedCertification.evidenceHash,
        browserEvidenceHash: hashSiteForgeContent(
          protectedCertification.browser
        ),
      },
      binding_hash: protectedCertification.bindingHash,
      evidence_hash: protectedCertification.evidenceHash,
      report_hash: hashSiteForgeContent(protectedCertification),
    })
  if (protectedEvidenceError) {
    throw new Error(
      `Failed to persist protected production evidence: ${protectedEvidenceError.message}`
    )
  }
  if (!protectedCertification.passed) {
    throw new FatalError(
      'Production render does not match the approved artifact'
    )
  }

  await setStage(
    input,
    'activating_indexing',
    75,
    'Clearing production noindex protection'
  )
  await assertProductionNotCancelled(input, client)
  let runtimeEvidence: Json | null = null
  if (runtimeV3) {
    const acfProLicenseKey = process.env.SITEFORGE_ACF_PRO_LICENSE_KEY?.trim()
    if (!credentials.ssh || !acfProLicenseKey) {
      throw new FatalError(
        'Runtime v3 production activation requires exact SSH and ACF package installation'
      )
    }
    const runtimeResult = await deployArtifactBoundRuntimeV3({
      release,
      target,
      deploymentId: input.deploymentId,
      sharedJobId: input.sharedJobId,
      environment: 'production',
      siteUrl: input.productionUrl,
      adminUrl: `${input.productionUrl.replace(/\/$/, '')}/wp-admin`,
      username: credentials.username,
      applicationPassword: credentials.password,
      ssh: credentials.ssh,
      acfProLicenseKey,
      publicRuntime,
      protection: { mode: 'public' },
      expectedRemoteContentHash: input.contentHash,
      client,
      assertActive: () => assertProductionNotCancelled(input, client),
      onProgress: async (_stage, detail) => {
        await setStage(input, 'activating_indexing', 80, detail)
        await assertProductionNotCancelled(input, client)
      },
    })
    runtimeEvidence = runtimeResult.evidence
  } else {
    await wp!.activateProduction(input.contentHash)
  }
  let certification
  try {
    await assertProductionNotCancelled(input, client)
    certification = await certifyRenderedWordPressArtifact({
      artifactId: input.artifactId,
      contentHash: input.contentHash,
      artifactBinding: buildReleaseCertificationBinding(release),
      targetUrl: input.productionUrl,
      credentials: {
        username: credentials.username,
        password: credentials.password,
      },
      pages,
      environment: 'production',
      access: 'public',
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
          bindingHash: certification.bindingHash,
          evidenceHash: certification.evidenceHash,
          browserEvidenceHash: hashSiteForgeContent(certification.browser),
        },
        binding_hash: certification.bindingHash,
        evidence_hash: certification.evidenceHash,
        report_hash: hashSiteForgeContent(certification),
      })
    if (publicEvidenceError) {
      throw new Error(
        `Failed to persist public production evidence: ${publicEvidenceError.message}`
      )
    }
    if (!certification.passed) {
      throw new FatalError(
        'Production activation failed indexability certification'
      )
    }
  } catch (cause) {
    if (runtimeV3) {
      throw cause
    }
    try {
      await restoreProductionProtection(wp!, {
        themeArtifact: themeArtifact!,
        legal: legal!,
        analytics: analytics!,
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
  const report = {
    ...asRecord(certification),
    ...(runtimeEvidence ? { runtimeEvidence } : {}),
  } as Json
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
        lease_owner: null,
        lease_expires_at: null,
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
    throw new Error(
      `Failed to persist production truth: ${completionError.message}`
    )
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
    throw new Error(
      'Production succeeded but launch certification could not be checkpointed'
    )
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
  if (input.evidenceOnly) {
    await client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'failed',
        status_reason: 'optional_browser_qa_failed',
        stage: 'failed',
        current_step: 'Optional browser QA could not complete',
        error_message: message,
        error_details: { message } as Json,
        lease_owner: null,
        lease_expires_at: null,
        finished_at: now,
        updated_at: now,
      })
      .eq('id', input.sharedJobId)
      .neq('lifecycle_status', 'cancelled')
    return
  }
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
        lease_owner: null,
        lease_expires_at: null,
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
        current_step:
          'Production certification failed; production remains protected',
        error_message: message,
        updated_at: now,
      })
      .eq('id', input.websiteId),
  ])
  try {
    await requestLaunchRestore(
      {
        releaseId: input.releaseId,
        propertyId: input.propertyId,
        rationale: `Operator restore required after post-promotion certification failure: ${message}`,
        actorId: input.actorId,
        requestId: input.sharedJobId,
        source: 'production_failure',
      },
      client
    )
  } catch (restoreError) {
    console.error(
      '[siteforge_production_certification] restore request failed',
      {
        releaseId: input.releaseId,
        error:
          restoreError instanceof Error
            ? restoreError.message
            : String(restoreError),
      }
    )
  }
}
