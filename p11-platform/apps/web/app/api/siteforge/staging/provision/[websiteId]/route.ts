import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Json } from '@/types/supabase'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  CloudwaysProviderClient,
  getCloudwaysProviderCredentials,
} from '@/utils/siteforge/providers/cloudways-provider'
import { getWordPressCredentialReference } from '@/utils/siteforge/wordpress/credential-vault'
import { readCloudwaysProvisioningCheckpoint } from '@/utils/siteforge/workflows/staging-steps'
import { createServiceClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'

const requestSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/)
      .optional(),
  })
  .strict()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/staging/provision/[websiteId]'
  )
  ctx.logStart()

  try {
    const { websiteId } = await params
    const parsed = requestSchema.safeParse(
      await request.json().catch(() => ({}))
    )
    if (!z.string().uuid().safeParse(websiteId).success || !parsed.success) {
      return NextResponse.json(
        { error: 'Valid staging WordPress provisioning input is required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }

    const client = createServiceClient()
    const { data: website, error: websiteError } = await client
      .from('property_websites')
      .select('id, org_id, property_id, wordpress_credential_ref')
      .eq('id', websiteId)
      .single()
    if (websiteError || !website) {
      return NextResponse.json(
        { error: 'Website not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    const access = await validatePropertyManagerAccess(
      user.id,
      website.property_id
    )
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const cloudwaysCredentials = getCloudwaysProviderCredentials()
    if (!website.wordpress_credential_ref || !cloudwaysCredentials) {
      return NextResponse.json(
        {
          error:
            'A linked Cloudways production application and Cloudways API credentials are required',
          requiresConfig: true,
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const parent = await getWordPressCredentialReference(
      website.wordpress_credential_ref
    )
    if (parent.provider !== 'cloudways' || !parent.providerMetadata) {
      return NextResponse.json(
        { error: 'The linked production target is not a Cloudways application' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const { serverId, applicationId: parentApplicationId } =
      parent.providerMetadata

    const { data: existingTarget, error: targetLookupError } = await client
      .from('siteforge_wordpress_targets')
      .select(
        'id, status, metadata, provider_application_id, provider_parent_application_id'
      )
      .eq('website_id', website.id)
      .eq('target_type', 'staging')
      .eq('is_active', true)
      .maybeSingle()
    if (targetLookupError) throw new Error(targetLookupError.message)

    let target = existingTarget
    if (!target) {
      const { data: createdTarget, error: createTargetError } = await client
        .from('siteforge_wordpress_targets')
        .insert({
          org_id: website.org_id,
          property_id: website.property_id,
          website_id: website.id,
          target_type: 'staging',
          provider: 'cloudways',
          provider_server_id: serverId,
          provider_parent_application_id: parentApplicationId,
          protection_mode: 'password_noindex',
          status: 'pending',
          is_active: true,
          metadata: {
            provisioningPolicy: 'siteforge-staging-provisioning-v1',
          } as Json,
        })
        .select(
          'id, status, metadata, provider_application_id, provider_parent_application_id'
        )
        .single()
      if (createTargetError || !createdTarget) {
        if (createTargetError?.code !== '23505') {
          throw new Error(
            `Failed to create staging target: ${
              createTargetError?.message || 'missing row'
            }`
          )
        }
        const { data: concurrentTarget, error: concurrentTargetError } =
          await client
            .from('siteforge_wordpress_targets')
            .select(
              'id, status, metadata, provider_application_id, provider_parent_application_id'
            )
            .eq('website_id', website.id)
            .eq('target_type', 'staging')
            .eq('is_active', true)
            .single()
        if (concurrentTargetError || !concurrentTarget) {
          throw new Error('Concurrent staging target could not be loaded')
        }
        target = concurrentTarget
      } else {
        target = createdTarget
      }
    }

    if (!target) throw new Error('Staging target identity is missing')
    if (
      target.provider_parent_application_id &&
      target.provider_parent_application_id !== parentApplicationId
    ) {
      return NextResponse.json(
        {
          error:
            'The active staging target belongs to a different production application',
          requiresProviderReconciliation: true,
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const checkpoint = readCloudwaysProvisioningCheckpoint(target.metadata)
    const metadata = asRecord(target.metadata)
    if (target.provider_application_id || checkpoint.applicationId) {
      return NextResponse.json(
        {
          targetId: target.id,
          status: target.status,
          applicationId:
            target.provider_application_id || checkpoint.applicationId,
          operationId: checkpoint.operationId,
          duplicate: true,
        },
        { status: 200, headers: ctx.responseHeaders }
      )
    }
    if (metadata.provisioningCheckpoint && !checkpoint.operationId) {
      return NextResponse.json(
        {
          error:
            'Staging provisioning has an unresolved provider initiation claim. Verify the Cloudways staging child before retrying so a duplicate is not created.',
          requiresProviderReconciliation: true,
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    if (checkpoint.operationId) {
      return NextResponse.json(
        {
          targetId: target.id,
          status: 'provisioning',
          operationId: checkpoint.operationId,
          duplicate: true,
        },
        { status: 202, headers: ctx.responseHeaders }
      )
    }

    const now = new Date().toISOString()
    const claimId = randomUUID()
    const label =
      parsed.data.label || `siteforge-staging-${website.id.slice(0, 8)}`
    const { data: claimedTarget, error: claimError } = await client
      .from('siteforge_wordpress_targets')
      .update({
        provider_server_id: serverId,
        provider_parent_application_id: parentApplicationId,
        status: 'provisioning',
        metadata: {
          ...metadata,
          provisioningCheckpoint: {
            state: 'initiating',
            claimId,
            serverId,
            parentApplicationId,
            label,
            claimedAt: now,
          },
        } as Json,
        updated_at: now,
      })
      .eq('id', target.id)
      .filter('metadata->provisioningCheckpoint', 'is', null)
      .select('id')
      .maybeSingle()
    if (claimError || !claimedTarget) {
      return NextResponse.json(
        {
          error: 'Another request already owns staging provisioning',
          retryable: true,
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const cloudways = new CloudwaysProviderClient(cloudwaysCredentials)
    let providerResult: {
      operationId: string | null
      applicationId: string | null
    }
    try {
      providerResult = await cloudways.createStagingApplication({
        serverId,
        parentApplicationId,
        label,
      })
    } catch (error) {
      await markStagingStartFailed(
        client,
        target.id,
        error instanceof Error ? error.message : 'Unknown provider error'
      )
      return NextResponse.json(
        {
          error: 'Failed to create the Cloudways staging application',
          detail:
            error instanceof Error ? error.message : 'Unknown provider error',
        },
        { status: 502, headers: ctx.responseHeaders }
      )
    }
    if (!providerResult.operationId && !providerResult.applicationId) {
      await markStagingStartFailed(
        client,
        target.id,
        'Cloudways did not return a staging application operation identity'
      )
      return NextResponse.json(
        { error: 'Cloudways did not return a staging operation identity' },
        { status: 502, headers: ctx.responseHeaders }
      )
    }

    const { data: checkpointed, error: checkpointError } = await client
      .from('siteforge_wordpress_targets')
      .update({
        provider_server_id: serverId,
        provider_parent_application_id: parentApplicationId,
        provider_application_id: providerResult.applicationId,
        status: 'provisioning',
        metadata: {
          ...metadata,
          provisioningCheckpoint: {
            state: 'started',
            claimId,
            operationId: providerResult.operationId,
            applicationId: providerResult.applicationId,
            serverId,
            parentApplicationId,
            label,
            initiatedAt: now,
          },
        } as Json,
        updated_at: now,
      })
      .eq('id', target.id)
      .contains('metadata', {
        provisioningCheckpoint: { claimId },
      })
      .select('id')
      .maybeSingle()
    if (checkpointError || !checkpointed) {
      throw new Error(
        `Failed to persist Cloudways staging checkpoint: ${
          checkpointError?.message || 'target row was not updated'
        }`
      )
    }

    ctx.logSuccess(202, { targetId: target.id })
    return NextResponse.json(
      {
        targetId: target.id,
        status: 'provisioning',
        operationId: providerResult.operationId,
        applicationId: providerResult.applicationId,
      },
      { status: 202, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to provision staging WordPress' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

async function markStagingStartFailed(
  client: ReturnType<typeof createServiceClient>,
  targetId: string,
  message: string
): Promise<void> {
  const now = new Date().toISOString()
  const { data: target } = await client
    .from('siteforge_wordpress_targets')
    .select('metadata')
    .eq('id', targetId)
    .maybeSingle()
  await client
    .from('siteforge_wordpress_targets')
    .update({
      status: 'failed',
      metadata: {
        ...asRecord(target?.metadata),
        provisioningFailure: { message, failedAt: now },
      } as Json,
      updated_at: now,
    })
    .eq('id', targetId)
}
