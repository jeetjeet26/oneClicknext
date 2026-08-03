import { FatalError } from 'workflow'
import { brandForgeContractV1Schema } from '@/utils/brandforge/contracts'
import type { GeneratedPage } from '@/types/siteforge'
import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { normalizeLegacyPages } from '@/utils/siteforge/blueprint'
import { loadVerifiedSiteForgeRelease } from '@/utils/siteforge/artifacts/release'
import { CloudwaysProviderClient } from '@/utils/siteforge/providers/cloudways-provider'
import {
  getWordPressCredentialReference,
  storeWordPressCredentialReference,
} from '@/utils/siteforge/wordpress/credential-vault'
import { SshWordPressInstaller } from '@/utils/siteforge/wordpress/wordpress-installer'
import {
  deployToExistingWordPress,
  WordPressAPIClient,
} from '@/utils/siteforge/wordpress-client'
import { validateWordPressThemeArtifact } from '@/utils/siteforge/wordpress/theme-artifact'
import {
  siteForgeAnalyticsConfigSchema,
  siteForgeLegalConfigSchema,
} from '@/utils/siteforge/quality/deterministic-gates'
import { loadSiteForgePublicRuntimeConfig } from '@/utils/siteforge/public-runtime'
import {
  buildRenderedCertificationTruth,
  certifyRenderedWordPressArtifact,
} from '@/utils/siteforge/verification/rendered-certification'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export interface SiteForgeStagingWorkflowInput {
  sharedJobId: string
  deploymentId: string
  targetId: string
  websiteId: string
  propertyId: string
  orgId: string
  artifactId: string
  contentHash: string
  approvalId: string
  localSimulation: boolean
  startedAt: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function readCloudwaysProvisioningCheckpoint(metadata: unknown): {
  operationId: string | null
  applicationId: string | null
} {
  const checkpoint = asRecord(asRecord(metadata).provisioningCheckpoint)
  return {
    operationId:
      typeof checkpoint.operationId === 'string' ? checkpoint.operationId : null,
    applicationId:
      typeof checkpoint.applicationId === 'string'
        ? checkpoint.applicationId
        : null,
  }
}

async function updateStage(
  input: SiteForgeStagingWorkflowInput,
  stage: string,
  progress: number,
  currentStep: string
) {
  const client = createServiceClient()
  const now = new Date().toISOString()
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
      .eq('id', input.sharedJobId),
    client
      .from('siteforge_artifact_deployments')
      .update({
        status: stage === 'certifying' ? 'certifying' : 'deploying',
      })
      .eq('id', input.deploymentId),
    client
      .from('property_websites')
      .update({
        editor_lifecycle_status: 'deploying_staging',
        generation_status: 'deploying',
        current_step: currentStep,
        updated_at: now,
      })
      .eq('id', input.websiteId),
  ])
}

async function assertStagingNotCancelled(
  input: SiteForgeStagingWorkflowInput,
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
    throw new FatalError('SiteForge staging deployment was cancelled')
  }
}

export async function assertStagingDeploymentActive(
  input: SiteForgeStagingWorkflowInput
): Promise<void> {
  'use step'
  const client = createServiceClient()
  const [{ data: job }, { data: website }, { data: artifact }] = await Promise.all([
    client
      .from('shared_jobs')
      .select('lifecycle_status, cancel_requested')
      .eq('id', input.sharedJobId)
      .eq('domain', 'siteforge.deployment')
      .single(),
    client
      .from('property_websites')
      .select(
        'current_artifact_version_id, canonical_preview_artifact_id, canonical_preview_content_hash, editor_lifecycle_status'
      )
      .eq('id', input.websiteId)
      .eq('property_id', input.propertyId)
      .eq('org_id', input.orgId)
      .single(),
    client
      .from('siteforge_blueprint_versions')
      .select('deployment_decision, confirmed_approval_id, content_hash')
      .eq('id', input.artifactId)
      .eq('website_id', input.websiteId)
      .single(),
  ])
  if (!job || job.cancel_requested || job.lifecycle_status === 'cancelled') {
    throw new FatalError('SiteForge staging deployment is cancelled or unavailable')
  }
  if (
    !website ||
    website.current_artifact_version_id !== input.artifactId ||
    website.canonical_preview_artifact_id !== input.artifactId ||
    website.canonical_preview_content_hash !== input.contentHash
  ) {
    throw new FatalError('Staging deployment artifact changed after preview approval')
  }
  if (
    !artifact ||
    artifact.content_hash !== input.contentHash ||
    artifact.deployment_decision !== 'approved' ||
    artifact.confirmed_approval_id !== input.approvalId
  ) {
    throw new FatalError('Exact artifact staging approval is missing or stale')
  }
}

export async function runSiteForgeStagingDeployment(
  input: SiteForgeStagingWorkflowInput
) {
  'use step'
  const client = createServiceClient()
  await assertStagingNotCancelled(input, client)
  await updateStage(input, 'preparing_staging', 5, 'Preparing linked Cloudways staging')
  const release = await loadVerifiedSiteForgeRelease(input, client)
  const blueprint = asRecord(release.artifact.blueprint)
  const pages = normalizeLegacyPages(
    Array.isArray(blueprint.pages)
      ? (blueprint.pages as unknown as GeneratedPage[])
      : []
  )
  if (!pages.length) throw new FatalError('Artifact contains no staging pages')
  const themeArtifact = validateWordPressThemeArtifact(
    blueprint.wordpressThemeArtifact
  )
  const legal = siteForgeLegalConfigSchema.parse(blueprint.legal)
  const analytics = siteForgeAnalyticsConfigSchema.parse(blueprint.analytics)
  const propertySnapshot = asRecord(blueprint.propertySnapshot)
  const snapshotProperty = asRecord(propertySnapshot.property)
  const brandSnapshot = asRecord(blueprint.brandSnapshot)
  const brandContractResult = brandForgeContractV1Schema.safeParse(
    brandSnapshot.contract,
  )
  const propertyContext = {
    name:
      typeof snapshotProperty.name === 'string'
        ? snapshotProperty.name
        : 'Property Website',
    tagline:
      typeof snapshotProperty.tagline === 'string'
        ? snapshotProperty.tagline
        : '',
  }

  if (input.localSimulation) {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.PLAYWRIGHT_BASE_URL ||
      'http://127.0.0.1:3000'
    return completeStagingDeployment(input, {
      url: `${base}/siteforge/preview/${input.websiteId}`,
      adminUrl: `${base}/siteforge/preview/${input.websiteId}`,
      dashboardUrl: null,
      certification: {
        passed: true,
        artifactId: input.artifactId,
        contentHash: input.contentHash,
        targetUrl: `${base}/siteforge/preview/${input.websiteId}`,
        verifiedAt: new Date().toISOString(),
        checks: [],
      },
      pages: pages.length,
      assets: release.assets.length,
    })
  }

  const { data: website, error: websiteError } = await client
    .from('property_websites')
    .select('wordpress_credential_ref')
    .eq('id', input.websiteId)
    .single()
  if (websiteError || !website?.wordpress_credential_ref) {
    throw new FatalError('A linked Cloudways parent application is required')
  }
  const parentCredentials = await getWordPressCredentialReference(
    website.wordpress_credential_ref
  )
  if (
    parentCredentials.provider !== 'cloudways' ||
    !parentCredentials.providerMetadata ||
    !parentCredentials.ssh
  ) {
    throw new FatalError('The linked WordPress target is not a Cloudways parent application')
  }
  if (!process.env.CLOUDWAYS_API_KEY || !process.env.CLOUDWAYS_EMAIL) {
    throw new FatalError('Cloudways API credentials are required for staging')
  }

  const { data: target, error: targetError } = await client
    .from('siteforge_wordpress_targets')
    .select('*')
    .eq('id', input.targetId)
    .eq('website_id', input.websiteId)
    .eq('target_type', 'staging')
    .eq('is_active', true)
    .single()
  if (targetError || !target) throw new FatalError('Cloudways staging target not found')

  let stagingCredentials =
    target.credential_ref
      ? await getWordPressCredentialReference(target.credential_ref)
      : null
  let stagingApplicationId = target.provider_application_id
  let stagingUrl = target.site_url
  let stagingAdminUrl = target.admin_url
  let stagingDashboardUrl = target.dashboard_url
  const targetMetadata = asRecord(target.metadata)
  const provisioningCheckpoint = readCloudwaysProvisioningCheckpoint(
    target.metadata
  )
  const checkpointOperationId = provisioningCheckpoint.operationId
  stagingApplicationId =
    stagingApplicationId || provisioningCheckpoint.applicationId

  if (!stagingCredentials || !stagingApplicationId || !stagingUrl) {
    await assertStagingNotCancelled(input, client)
    await updateStage(input, 'provisioning_staging', 20, 'Creating linked Cloudways staging application')
    const cloudways = new CloudwaysProviderClient({
      apiKey: process.env.CLOUDWAYS_API_KEY,
      email: process.env.CLOUDWAYS_EMAIL,
    })
    let operationId = checkpointOperationId
    if (!stagingApplicationId && !operationId) {
      const provision = await cloudways.createStagingApplication({
        serverId: parentCredentials.providerMetadata.serverId,
        parentApplicationId: parentCredentials.providerMetadata.applicationId,
        label: `siteforge-${input.websiteId.slice(0, 8)}-staging`,
      })
      operationId = provision.operationId
      stagingApplicationId = provision.applicationId
      const checkpointAt = new Date().toISOString()
      const { data: checkpointed, error: checkpointError } = await client
        .from('siteforge_wordpress_targets')
        .update({
          provider_application_id: stagingApplicationId,
          status: 'provisioning',
          metadata: {
            ...targetMetadata,
            provisioningCheckpoint: {
              operationId,
              applicationId: stagingApplicationId,
              parentApplicationId:
                parentCredentials.providerMetadata.applicationId,
              serverId: parentCredentials.providerMetadata.serverId,
              checkpointedAt: checkpointAt,
            },
          } as Json,
          updated_at: checkpointAt,
        })
        .eq('id', target.id)
        .select('id')
        .maybeSingle()
      if (checkpointError || !checkpointed) {
        throw new Error(
          `Cloudways staging was requested but its retry checkpoint could not be persisted: ${
            checkpointError?.message || 'target row was not updated'
          }`
        )
      }
    }
    if (operationId) {
      await cloudways.waitForOperation(operationId)
    }
    await assertStagingNotCancelled(input, client)
    const application = await cloudways.getApplication({
      serverId: parentCredentials.providerMetadata.serverId,
      applicationId: stagingApplicationId,
      parentApplicationId: parentCredentials.providerMetadata.applicationId,
    })
    stagingApplicationId = String(application.id)
    stagingUrl = /^https?:\/\//.test(application.app_fqdn)
      ? application.app_fqdn
      : `https://${application.app_fqdn}`
    stagingAdminUrl = `${stagingUrl.replace(/\/$/, '')}/wp-admin`
    stagingDashboardUrl = `https://platform.cloudways.com/apps/${stagingApplicationId}/access-details`
    const credentialRef = await storeWordPressCredentialReference({
      websiteId: input.websiteId,
      secretName: `${input.websiteId}:staging:${stagingApplicationId}`,
      description: 'SiteForge linked Cloudways staging credential',
      linkWebsite: false,
      credentials: {
        provider: 'cloudways',
        url: stagingUrl,
        username: parentCredentials.username,
        password: parentCredentials.password,
        ssh: {
          host:
            application.public_ip ||
            parentCredentials.providerMetadata.publicIp,
          port: 22,
          username: application.app_user,
          password: application.app_password,
          applicationRoot: 'public_html',
        },
        providerMetadata: {
          provider: 'cloudways',
          serverId: parentCredentials.providerMetadata.serverId,
          applicationId: stagingApplicationId,
          publicIp:
            application.public_ip ||
            parentCredentials.providerMetadata.publicIp,
        },
      },
    })
    stagingCredentials = await getWordPressCredentialReference(credentialRef)
    const { data: persistedTarget, error: persistTargetError } = await client
      .from('siteforge_wordpress_targets')
      .update({
        provider_application_id: stagingApplicationId,
        site_url: stagingUrl,
        admin_url: stagingAdminUrl,
        dashboard_url: stagingDashboardUrl,
        credential_ref: credentialRef,
        status: 'ready',
        metadata: {
          ...targetMetadata,
          provisioningCheckpoint: {
            operationId,
            applicationId: stagingApplicationId,
            parentApplicationId: parentCredentials.providerMetadata.applicationId,
            serverId: parentCredentials.providerMetadata.serverId,
            completedAt: new Date().toISOString(),
          },
        } as Json,
        updated_at: new Date().toISOString(),
      })
      .eq('id', target.id)
      .select('id')
      .maybeSingle()
    if (persistTargetError || !persistedTarget) {
      throw new Error(
        `Failed to persist Cloudways staging identity: ${
          persistTargetError?.message || 'target row was not updated'
        }`
      )
    }
  }
  if (!stagingCredentials?.ssh || !stagingUrl || !stagingAdminUrl) {
    throw new FatalError('Cloudways staging credentials are incomplete')
  }

  await updateStage(input, 'deploying_staging', 45, 'Deploying exact release to Cloudways staging')
  await assertStagingNotCancelled(input, client)
  const installer = new SshWordPressInstaller()
  const acfProLicenseKey = process.env.SITEFORGE_ACF_PRO_LICENSE_KEY
  if (!acfProLicenseKey) throw new FatalError('SITEFORGE_ACF_PRO_LICENSE_KEY is required')
  await installer.ensureInstalled({
    ssh: stagingCredentials.ssh,
    acfProLicenseKey,
  })
  if (release.overlayPackage && release.overlayContentHash) {
    await installer.installThemeOverlay({
      ssh: stagingCredentials.ssh,
      archive: release.overlayPackage,
      contentHash: release.overlayContentHash,
    })
  }
  await assertStagingNotCancelled(input, client)
  const instance = await deployToExistingWordPress({
    wpUrl: stagingUrl,
    credentials: {
      username: stagingCredentials.username,
      password: stagingCredentials.password,
    },
    pages,
    propertyContext,
    assets: release.assets,
    contentHash: input.contentHash,
    siteConfiguration: themeArtifact.siteConfiguration,
    requireContentManifest: true,
  })
  const publicRuntime = await loadSiteForgePublicRuntimeConfig(
    input.websiteId,
    input.propertyId,
    client
  )
  await assertStagingNotCancelled(input, client)
  await new WordPressAPIClient(instance.url, instance.credentials).applySiteForgeSettings({
    themeArtifact,
    legal,
    analytics,
    publicRuntime,
    targetMode: 'staging',
  })

  await updateStage(input, 'certifying', 85, 'Certifying exact Cloudways staging render')
  await assertStagingNotCancelled(input, client)
  const certification = await certifyRenderedWordPressArtifact({
    artifactId: input.artifactId,
    contentHash: input.contentHash,
    targetUrl: instance.url,
    credentials: instance.credentials,
    pages,
    brandContract: brandContractResult.success
      ? brandContractResult.data
      : undefined,
    ...buildRenderedCertificationTruth(
      propertySnapshot,
      release.assets.map(asset => asset.fileUrl),
      publicRuntime.conversionEndpoint,
    ),
  })
  const { error: evidenceError } = await client
    .from('siteforge_certification_evidence')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      website_id: input.websiteId,
      artifact_id: input.artifactId,
      policy_version: certification.policyVersion,
      environment: 'staging',
      status: certification.passed ? 'passed' : 'failed',
      report: certification as unknown as Json,
      evidence_manifest: {
        targetUrl: instance.url,
        browserEvidenceHash: hashSiteForgeContent(certification.browser),
      },
      report_hash: hashSiteForgeContent(certification),
    })
  if (evidenceError) {
    throw new Error(
      `Failed to persist staging certification evidence: ${evidenceError.message}`
    )
  }
  if (!certification.passed) {
    const blockers = certification.checks
      .filter(check => !check.passed && check.severity === 'blocker')
      .map(check => check.id)
    throw new FatalError(`Cloudways staging certification failed: ${blockers.join(', ')}`)
  }

  return completeStagingDeployment(input, {
    url: instance.url,
    adminUrl: instance.adminUrl,
    dashboardUrl: stagingDashboardUrl,
    certification: certification as unknown as Json,
    pages: pages.length,
    assets: release.assets.length,
  })
}

async function completeStagingDeployment(
  input: SiteForgeStagingWorkflowInput,
  output: {
    url: string
    adminUrl: string
    dashboardUrl: string | null
    certification: Json
    pages: number
    assets: number
  }
) {
  const client = createServiceClient()
  const now = new Date().toISOString()
  const [deployment, target, website, job] = await Promise.all([
    client
      .from('siteforge_artifact_deployments')
      .update({
        status: 'ready',
        certification_report: output.certification,
        deployed_url: output.url,
        admin_url: output.adminUrl,
        deployed_at: now,
        certified_at: now,
        remote_manifest_hash: input.contentHash,
      })
      .eq('id', input.deploymentId)
      .select('id')
      .maybeSingle(),
    client
      .from('siteforge_wordpress_targets')
      .update({
        status: 'ready',
        site_url: output.url,
        admin_url: output.adminUrl,
        updated_at: now,
      })
      .eq('id', input.targetId)
      .select('id')
      .maybeSingle(),
    client
      .from('property_websites')
      .update({
        editor_lifecycle_status: 'staging_ready',
        generation_status: 'complete',
        current_step: 'Cloudways staging is ready; Push to Live remains in Cloudways',
        staging_target_id: input.targetId,
        staging_artifact_id: input.artifactId,
        staging_content_hash: input.contentHash,
        staging_url: output.url,
        staging_admin_url: output.adminUrl,
        staging_certified_at: now,
        error_message: null,
        updated_at: now,
      })
      .eq('id', input.websiteId)
      .eq('current_artifact_version_id', input.artifactId)
      .select('id')
      .maybeSingle(),
    client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'succeeded',
        status_reason: 'staging_ready',
        stage: 'staging_ready',
        progress: 100,
        current_step: 'Cloudways staging ready',
        output: {
          ...output,
          artifactId: input.artifactId,
          contentHash: input.contentHash,
          pushToLiveLocation: 'siteforge_launch_release',
        } as unknown as Json,
        finished_at: now,
        heartbeat_at: now,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: now,
      })
      .eq('id', input.sharedJobId)
      .select('id')
      .maybeSingle(),
  ])
  if (
    deployment.error ||
    !deployment.data ||
    target.error ||
    !target.data ||
    website.error ||
    !website.data ||
    job.error ||
    !job.data
  ) {
    throw new Error(
      `Failed to persist staging terminal state: ${
        deployment.error?.message ||
        target.error?.message ||
        website.error?.message ||
        job.error?.message ||
        'one or more rows were not updated'
      }`
    )
  }
  return output
}

export async function failSiteForgeStagingDeployment(
  input: SiteForgeStagingWorkflowInput,
  message: string
): Promise<void> {
  'use step'
  const client = createServiceClient()
  const now = new Date().toISOString()
  const [deployment, target, website, job] = await Promise.all([
    client
      .from('siteforge_artifact_deployments')
      .update({ status: 'failed', certification_report: { error: message } })
      .eq('id', input.deploymentId)
      .select('id')
      .maybeSingle(),
    client
      .from('siteforge_wordpress_targets')
      .update({ status: 'failed', updated_at: now })
      .eq('id', input.targetId)
      .eq('status', 'provisioning')
      .select('id')
      .maybeSingle(),
    client
      .from('property_websites')
      .update({
        editor_lifecycle_status: 'approved_for_staging',
        generation_status: 'deploy_failed',
        current_step: 'Cloudways staging deployment failed',
        error_message: message,
        updated_at: now,
      })
      .eq('id', input.websiteId)
      .select('id')
      .maybeSingle(),
    client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'failed',
        status_reason: 'staging_failed',
        stage: 'failed',
        current_step: 'Cloudways staging deployment failed',
        error_message: message,
        error_details: { message } as Json,
        finished_at: now,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: now,
      })
      .eq('id', input.sharedJobId)
      .neq('lifecycle_status', 'cancelled')
      .select('id')
      .maybeSingle(),
  ])
  if (
    deployment.error ||
    !deployment.data ||
    website.error ||
    !website.data ||
    job.error ||
    !job.data ||
    target.error
  ) {
    throw new Error(
      `Failed to persist staging failure state: ${
        deployment.error?.message ||
        target.error?.message ||
        website.error?.message ||
        job.error?.message ||
        'one or more required rows were not updated'
      }`
    )
  }
}

runSiteForgeStagingDeployment.maxRetries = 0
