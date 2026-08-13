import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  CloudwaysProviderClient,
  getCloudwaysProviderCredentials,
} from '@/utils/siteforge/providers/cloudways-provider'
import {
  createWordPressApplicationPassword,
  type WordPressSshCredentials,
} from '@/utils/siteforge/wordpress/wordpress-installer'
import { storeWordPressCredentialReference } from '@/utils/siteforge/wordpress/credential-vault'
import { readCloudwaysProvisioningCheckpoint } from '@/utils/siteforge/workflows/staging-steps'

export type SiteForgeProductionProvisioningInput = {
  sharedJobId: string
  targetId: string
  websiteId: string
  propertyId: string
  orgId: string
  serverId: string
  startedAt: string
}

async function updateProvisioningStage(
  input: SiteForgeProductionProvisioningInput,
  stage: string,
  progress: number,
  currentStep: string
): Promise<void> {
  const client = createServiceClient()
  const now = new Date().toISOString()
  const { data, error } = await client
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
    .eq('domain', 'siteforge.production_provisioning')
    .select('id')
    .maybeSingle()
  if (error || !data) {
    throw new Error(
      `Failed to update production provisioning progress: ${
        error?.message || 'job row was not updated'
      }`
    )
  }
}

export async function assertProductionProvisioningActive(
  input: SiteForgeProductionProvisioningInput
): Promise<void> {
  'use step'
  const client = createServiceClient()
  const [{ data: job }, { data: target }] = await Promise.all([
    client
      .from('shared_jobs')
      .select('lifecycle_status, cancel_requested')
      .eq('id', input.sharedJobId)
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .eq('domain', 'siteforge.production_provisioning')
      .single(),
    client
      .from('siteforge_wordpress_targets')
      .select('id, status')
      .eq('id', input.targetId)
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .eq('website_id', input.websiteId)
      .eq('target_type', 'production')
      .eq('is_active', true)
      .single(),
  ])
  if (
    !job ||
    job.cancel_requested ||
    !['queued', 'running', 'retrying'].includes(job.lifecycle_status) ||
    !target ||
    !['pending', 'provisioning'].includes(target.status)
  ) {
    throw new Error('Production WordPress provisioning is no longer active')
  }
}

export async function runProductionProvisioning(
  input: SiteForgeProductionProvisioningInput
): Promise<{
  applicationId: string
  siteUrl: string
  adminUrl: string
  dashboardUrl: string
}> {
  'use step'
  const client = createServiceClient()
  await updateProvisioningStage(
    input,
    'waiting_for_cloudways',
    10,
    'Waiting for the dedicated Cloudways WordPress application'
  )
  const { data: target, error: targetError } = await client
    .from('siteforge_wordpress_targets')
    .select(
      'id, metadata, provider_application_id, provider_server_id, credential_ref, site_url, admin_url, dashboard_url'
    )
    .eq('id', input.targetId)
    .eq('website_id', input.websiteId)
    .eq('target_type', 'production')
    .single()
  if (targetError || !target) {
    throw new Error(
      `Production WordPress target was not found: ${
        targetError?.message || 'missing row'
      }`
    )
  }
  if (
    target.provider_application_id &&
    target.credential_ref &&
    target.site_url &&
    target.admin_url &&
    target.dashboard_url
  ) {
    await completeProvisioningJob(input, {
      applicationId: target.provider_application_id,
      siteUrl: target.site_url,
      adminUrl: target.admin_url,
      dashboardUrl: target.dashboard_url,
    })
    return {
      applicationId: target.provider_application_id,
      siteUrl: target.site_url,
      adminUrl: target.admin_url,
      dashboardUrl: target.dashboard_url,
    }
  }
  const cloudwaysCredentials = getCloudwaysProviderCredentials()
  if (!cloudwaysCredentials) {
    throw new Error('Cloudways API credentials are required')
  }
  const checkpoint = readCloudwaysProvisioningCheckpoint(target.metadata)
  let applicationId =
    target.provider_application_id || checkpoint.applicationId
  if (!applicationId && !checkpoint.operationId) {
    throw new Error(
      'SITEFORGE_PROVIDER_IDEMPOTENCY_UNAVAILABLE: a persisted Cloudways application operation checkpoint is required'
    )
  }
  const cloudways = new CloudwaysProviderClient(cloudwaysCredentials)
  if (!applicationId && checkpoint.operationId) {
    const operation = await cloudways.waitForOperation(checkpoint.operationId)
    applicationId =
      operation.app_id !== undefined
        ? String(operation.app_id)
        : operation.application_id !== undefined
          ? String(operation.application_id)
          : null
  }
  if (!applicationId) {
    throw new Error(
      'Cloudways did not reveal the production application identity'
    )
  }

  await updateProvisioningStage(
    input,
    'creating_wordpress_credentials',
    55,
    'Creating a dedicated WordPress REST application password'
  )
  const application = await cloudways.getApplication({
    serverId: input.serverId,
    applicationId,
  })
  if (
    !application.public_ip ||
    !application.master_user ||
    !application.sys_user
  ) {
    throw new Error(
      'Cloudways application is missing its master-user SSH identity'
    )
  }
  const privateKey = process.env.SITEFORGE_CLOUDWAYS_SSH_PRIVATE_KEY?.replace(
    /\\n/g,
    '\n'
  )
  if (!privateKey) {
    throw new Error('SITEFORGE_CLOUDWAYS_SSH_PRIVATE_KEY is required')
  }
  const ssh: WordPressSshCredentials = {
    host: application.public_ip,
    port: 22,
    username: application.master_user,
    privateKey,
    applicationRoot: `/home/master/applications/${application.sys_user}/public_html`,
    sftpApplicationRoot: `/applications/${application.sys_user}/public_html`,
  }
  const wordpressCredential = await createWordPressApplicationPassword({ ssh })
  const siteUrl = /^https?:\/\//.test(application.app_fqdn)
    ? application.app_fqdn
    : `https://${application.app_fqdn}`
  const adminUrl = `${siteUrl.replace(/\/$/, '')}/wp-admin`
  const dashboardUrl = `https://platform.cloudways.com/apps/${applicationId}/access-details`

  await updateProvisioningStage(
    input,
    'storing_production_credentials',
    80,
    'Securing and linking the production WordPress credential'
  )
  const credentialRef = await storeWordPressCredentialReference({
    websiteId: input.websiteId,
    secretName: `${input.websiteId}:production:${applicationId}`,
    description: 'SiteForge dedicated Cloudways production credential',
    credentials: {
      provider: 'cloudways',
      url: siteUrl,
      username: wordpressCredential.username,
      password: wordpressCredential.applicationPassword,
      ssh: {
        host: application.public_ip,
        port: 22,
        username: application.app_user,
        password: application.app_password,
        applicationRoot: 'public_html',
      },
      providerMetadata: {
        provider: 'cloudways',
        serverId: input.serverId,
        applicationId,
        publicIp: application.public_ip,
      },
    },
  })
  const metadata =
    target.metadata &&
    typeof target.metadata === 'object' &&
    !Array.isArray(target.metadata)
      ? (target.metadata as Record<string, unknown>)
      : {}
  const completedAt = new Date().toISOString()
  const { data: updatedTarget, error: updateError } = await client
    .from('siteforge_wordpress_targets')
    .update({
      provider_application_id: applicationId,
      provider_server_id: input.serverId,
      site_url: siteUrl,
      admin_url: adminUrl,
      dashboard_url: dashboardUrl,
      credential_ref: credentialRef,
      protection_mode: 'public',
      status: 'ready',
      metadata: {
        ...metadata,
        provisioningCheckpoint: {
          ...((metadata.provisioningCheckpoint as Record<string, unknown>) ||
            {}),
          applicationId,
          serverId: input.serverId,
          completedAt,
        },
      } as Json,
      updated_at: completedAt,
    })
    .eq('id', input.targetId)
    .eq('website_id', input.websiteId)
    .select('id')
    .maybeSingle()
  if (updateError || !updatedTarget) {
    throw new Error(
      `Failed to persist the production WordPress target: ${
        updateError?.message || 'target row was not updated'
      }`
    )
  }
  const { data: linkedWebsite, error: websiteLinkError } = await client
    .from('property_websites')
    .update({
      production_target_id: input.targetId,
      updated_at: completedAt,
    })
    .eq('id', input.websiteId)
    .eq('property_id', input.propertyId)
    .eq('org_id', input.orgId)
    .eq('wordpress_credential_ref', credentialRef)
    .select('id')
    .maybeSingle()
  if (websiteLinkError || !linkedWebsite) {
    throw new Error(
      `Failed to link the production WordPress target: ${
        websiteLinkError?.message || 'website row was not updated'
      }`
    )
  }
  const output = { applicationId, siteUrl, adminUrl, dashboardUrl }
  await completeProvisioningJob(input, output)
  return output
}

async function completeProvisioningJob(
  input: SiteForgeProductionProvisioningInput,
  output: {
    applicationId: string
    siteUrl: string
    adminUrl: string
    dashboardUrl: string
  }
): Promise<void> {
  const client = createServiceClient()
  const now = new Date().toISOString()
  const { data, error } = await client
    .from('shared_jobs')
    .update({
      lifecycle_status: 'succeeded',
      status_reason: 'production_wordpress_ready',
      stage: 'ready',
      progress: 100,
      current_step: 'Dedicated production WordPress application is ready',
      result: output as unknown as Json,
      finished_at: now,
      heartbeat_at: now,
      lease_expires_at: null,
      updated_at: now,
    })
    .eq('id', input.sharedJobId)
    .eq('domain', 'siteforge.production_provisioning')
    .select('id')
    .maybeSingle()
  if (error || !data) {
    throw new Error(
      `Failed to complete production provisioning job: ${
        error?.message || 'job row was not updated'
      }`
    )
  }
}

export async function failProductionProvisioning(
  input: SiteForgeProductionProvisioningInput,
  message: string
): Promise<void> {
  'use step'
  const client = createServiceClient()
  const now = new Date().toISOString()
  await Promise.all([
    client
      .from('siteforge_wordpress_targets')
      .update({ status: 'failed', updated_at: now })
      .eq('id', input.targetId)
      .eq('website_id', input.websiteId)
      .in('status', ['pending', 'provisioning']),
    client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'failed',
        status_reason: 'production_provisioning_failed',
        stage: 'failed',
        current_step: 'Production WordPress provisioning failed',
        error_message: message,
        error_details: { message } as Json,
        finished_at: now,
        lease_expires_at: null,
        updated_at: now,
      })
      .eq('id', input.sharedJobId)
      .eq('domain', 'siteforge.production_provisioning'),
  ])
}
