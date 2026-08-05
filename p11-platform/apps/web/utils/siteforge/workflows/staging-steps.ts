import { FatalError } from 'workflow'
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
  propertyContextFromOnboardingSnapshot,
  runtimePropertyProfile,
} from '@/utils/siteforge/property-context'
import { deployArtifactBoundRuntimeV3 } from '@/utils/siteforge/workflows/runtime-deployment-v3'

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
      typeof checkpoint.operationId === 'string'
        ? checkpoint.operationId
        : null,
    applicationId:
      typeof checkpoint.applicationId === 'string'
        ? checkpoint.applicationId
        : null,
  }
}

export function assertExactStagingManifest(
  expectedContentHash: string,
  remoteContentHash: string | null
): void {
  if (remoteContentHash !== expectedContentHash) {
    throw new FatalError(
      'Cloudways staging manifest does not match the approved artifact'
    )
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
        lease_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
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
  const [{ data: job }, { data: website }, { data: artifact }] =
    await Promise.all([
      client
        .from('shared_jobs')
        .select('lifecycle_status, cancel_requested, lease_owner')
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
    throw new FatalError(
      'SiteForge staging deployment is cancelled or unavailable'
    )
  }
  const leaseOwner = `siteforge-staging:${input.sharedJobId}`
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
      .eq('domain', 'siteforge.deployment')
      .in('lifecycle_status', ['queued', 'running', 'retrying'])
      .is('lease_owner', null)
      .select('id')
      .maybeSingle()
    if (claimError || !claimed) {
      throw new FatalError('SiteForge staging deployment is already claimed')
    }
  }
  if (
    !website ||
    website.current_artifact_version_id !== input.artifactId ||
    website.canonical_preview_artifact_id !== input.artifactId ||
    website.canonical_preview_content_hash !== input.contentHash
  ) {
    throw new FatalError(
      'Staging deployment artifact changed after preview approval'
    )
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
  await updateStage(
    input,
    'preparing_staging',
    5,
    'Preparing linked Cloudways staging'
  )
  const release = await loadVerifiedSiteForgeRelease(input, client)
  const runtimeV3 = release.artifact.runtimeContractVersion === 3
  const blueprint = asRecord(release.artifact.blueprint)
  const pages = normalizeLegacyPages(
    Array.isArray(blueprint.pages)
      ? (blueprint.pages as unknown as GeneratedPage[])
      : []
  )
  if (!pages.length) throw new FatalError('Artifact contains no staging pages')
  const themeArtifact = runtimeV3
    ? null
    : validateWordPressThemeArtifact(blueprint.wordpressThemeArtifact)
  const legal = runtimeV3
    ? null
    : siteForgeLegalConfigSchema.parse(blueprint.legal)
  const analytics = runtimeV3
    ? null
    : siteForgeAnalyticsConfigSchema.parse(blueprint.analytics)
  const propertySnapshot = asRecord(blueprint.propertySnapshot)
  const fullPropertyContext =
    propertyContextFromOnboardingSnapshot(propertySnapshot)
  const snapshotProperty = asRecord(propertySnapshot.property)
  const propertyContext = {
    ...fullPropertyContext,
    tagline:
      typeof snapshotProperty.tagline === 'string'
        ? snapshotProperty.tagline
        : '',
  }

  if (input.localSimulation) {
    if (runtimeV3) {
      throw new FatalError(
        'Runtime v3 staging cannot bypass the artifact-bound remote transaction engine'
      )
    }
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
    throw new FatalError(
      'The linked WordPress target is not a Cloudways parent application'
    )
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
  if (targetError || !target)
    throw new FatalError('Cloudways staging target not found')

  let stagingCredentials = target.credential_ref
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
    await updateStage(
      input,
      'provisioning_staging',
      20,
      'Creating linked Cloudways staging application'
    )
    const cloudways = new CloudwaysProviderClient({
      apiKey: process.env.CLOUDWAYS_API_KEY,
      email: process.env.CLOUDWAYS_EMAIL,
    })
    const operationId = checkpointOperationId
    if (!stagingApplicationId && !operationId) {
      throw new FatalError(
        'SITEFORGE_PROVIDER_IDEMPOTENCY_UNAVAILABLE: create the exact Cloudways staging child outside the workflow and persist its application/operation checkpoint before retrying'
      )
    }
    if (!stagingApplicationId || !operationId) {
      throw new FatalError(
        'A complete Cloudways staging application and operation checkpoint is required'
      )
    }
    if (operationId) {
      await cloudways.waitForOperation(operationId)
    }
    await assertStagingNotCancelled(input, client)
    const application = await cloudways.getApplication({
      serverId: parentCredentials.providerMetadata.serverId,
      applicationId: stagingApplicationId,
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
            parentApplicationId:
              parentCredentials.providerMetadata.applicationId,
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

  await updateStage(
    input,
    'deploying_staging',
    45,
    'Deploying exact release to Cloudways staging'
  )
  await assertStagingNotCancelled(input, client)
  const acfProLicenseKey = process.env.SITEFORGE_ACF_PRO_LICENSE_KEY
  if (!acfProLicenseKey)
    throw new FatalError('SITEFORGE_ACF_PRO_LICENSE_KEY is required')
  const publicRuntime = await loadSiteForgePublicRuntimeConfig(
    input.websiteId,
    input.propertyId,
    client
  )
  let instance: {
    url: string
    adminUrl: string
    credentials: { username: string; password: string }
  }
  let runtimeEvidence: Json | null = null
  if (runtimeV3) {
    const runtimeResult = await deployArtifactBoundRuntimeV3({
      release,
      target,
      deploymentId: input.deploymentId,
      sharedJobId: input.sharedJobId,
      approvalId: input.approvalId,
      environment: 'staging',
      siteUrl: stagingUrl,
      adminUrl: stagingAdminUrl,
      username: stagingCredentials.username,
      applicationPassword: stagingCredentials.password,
      ssh: stagingCredentials.ssh,
      acfProLicenseKey,
      publicRuntime,
      protection: { mode: 'noindex' },
      client,
      assertActive: () => assertStagingNotCancelled(input, client),
      onProgress: async (_stage, detail) => {
        await updateStage(input, 'deploying_staging', 65, detail)
        await assertStagingNotCancelled(input, client)
      },
    })
    runtimeEvidence = runtimeResult.evidence
    instance = {
      url: stagingUrl,
      adminUrl: stagingAdminUrl,
      credentials: {
        username: stagingCredentials.username,
        password: stagingCredentials.password,
      },
    }
  } else {
    if (!themeArtifact || !legal || !analytics) {
      throw new FatalError('Legacy staging release configuration is incomplete')
    }
    const installer = new SshWordPressInstaller()
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
    instance = await deployToExistingWordPress({
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
    await assertStagingNotCancelled(input, client)
    await new WordPressAPIClient(
      instance.url,
      instance.credentials
    ).applySiteForgeSettings({
      themeArtifact,
      legal,
      analytics,
      propertyProfile: runtimePropertyProfile(propertyContext),
      publicRuntime,
      targetMode: 'staging',
    })
  }

  await updateStage(
    input,
    'verifying',
    85,
    'Verifying exact Cloudways staging artifact'
  )
  await assertStagingNotCancelled(input, client)
  const manifest = await new WordPressAPIClient(
    instance.url,
    instance.credentials
  ).getContentManifest()
  assertExactStagingManifest(input.contentHash, manifest.content_hash)
  const integrityReport = {
    policyVersion: 'siteforge-staging-integrity-v1',
    passed: true,
    artifactId: input.artifactId,
    contentHash: input.contentHash,
    remoteManifestHash: manifest.content_hash,
    verifiedAt: new Date().toISOString(),
    ...(runtimeEvidence ? { runtimeEvidence } : {}),
  }

  return completeStagingDeployment(input, {
    url: instance.url,
    adminUrl: instance.adminUrl,
    dashboardUrl: stagingDashboardUrl,
    certification: integrityReport as Json,
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
        current_step:
          'Cloudways staging is ready; Push to Live remains in Cloudways',
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
