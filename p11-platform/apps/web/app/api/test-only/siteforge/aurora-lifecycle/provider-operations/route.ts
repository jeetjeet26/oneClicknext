import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Database, Json } from '@/types/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  CloudwaysProviderClient,
  getCloudwaysProviderCredentials,
} from '@/utils/siteforge/providers/cloudways-provider'
import {
  AURORA_LIFECYCLE_DOMAIN,
  assertActiveAuroraLifecycleLease,
  AuroraLifecycleControlError,
  postgresUuidSchema,
  requireAuroraLifecycleIdentity,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'

const base = {
  propertyId: postgresUuidSchema,
  websiteId: postgresUuidSchema,
}
const AURORA_PROVIDER_OPERATION_DOMAIN =
  'siteforge.aurora-lifecycle.provider-operation'
const AURORA_PROVIDER_LEASE_MS = 15 * 60_000
export const maxDuration = 300
const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('start_backup'), ...base }).strict(),
  z.object({ operation: z.literal('poll_backup'), ...base }).strict(),
  z
    .object({
      operation: z.literal('start_promotion'),
      releaseId: postgresUuidSchema,
      ...base,
    })
    .strict(),
  z
    .object({
      operation: z.literal('verify_promotion'),
      releaseId: postgresUuidSchema,
      ...base,
    })
    .strict(),
  z
    .object({
      operation: z.literal('start_restore'),
      releaseId: postgresUuidSchema,
      ...base,
    })
    .strict(),
  z
    .object({
      operation: z.literal('poll_restore'),
      releaseId: postgresUuidSchema,
      ...base,
    })
    .strict(),
])

function record(
  value: Json | null | undefined
): Record<string, Json | undefined> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json | undefined>)
    : {}
}

export function boundedProviderLeaseExpiry(
  runExpiresAt: string,
  now = Date.now()
): string {
  return new Date(
    Math.min(new Date(runExpiresAt).getTime(), now + AURORA_PROVIDER_LEASE_MS)
  ).toISOString()
}

function controlledError(error: unknown, headers: Record<string, string>) {
  const status =
    error instanceof AuroraLifecycleControlError ? error.statusCode : 500
  return NextResponse.json(
    {
      error:
        status === 500
          ? 'Failed to control the exact Cloudways operation'
          : (error as Error).message,
      code:
        error instanceof AuroraLifecycleControlError
          ? error.code
          : 'provider_operation_failed',
    },
    { status, headers }
  )
}

async function claimProviderMutation(
  client: SupabaseClient<Database>,
  input: {
    orgId: string
    propertyId: string
    websiteId: string
    ownerId: string
    expiresAt: string
    operation: 'backup' | 'promotion' | 'restore'
    releaseId?: string
  }
) {
  const dedupeKey = [
    'aurora-provider',
    input.operation,
    input.websiteId,
    input.ownerId,
    input.releaseId || 'bootstrap',
  ].join(':')
  const now = new Date().toISOString()
  const inserted = await client
    .from('shared_jobs')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      domain: AURORA_PROVIDER_OPERATION_DOMAIN,
      subject_type: 'provider_operation',
      subject_id: input.websiteId,
      lifecycle_status: 'running',
      status_reason: `aurora_${input.operation}_provider_mutation_claimed`,
      dedupe_key: dedupeKey,
      payload: {
        lifecycleOwnerId: input.ownerId,
        lifecycleRunId: input.ownerId,
        operation: input.operation,
        releaseId: input.releaseId || null,
      },
      lease_owner: input.ownerId,
      lease_expires_at: boundedProviderLeaseExpiry(input.expiresAt),
      heartbeat_at: now,
      started_at: now,
      max_attempts: 1,
    })
    .select('id, lifecycle_status, output')
    .maybeSingle()
  if (inserted.data) return { job: inserted.data, claimed: true }
  if (inserted.error?.code !== '23505') {
    throw new Error(
      `Failed to claim Aurora ${input.operation} provider mutation`
    )
  }
  const { data: existing, error } = await client
    .from('shared_jobs')
    .select('id, lifecycle_status, output')
    .eq('org_id', input.orgId)
    .eq('domain', AURORA_PROVIDER_OPERATION_DOMAIN)
    .eq('dedupe_key', dedupeKey)
    .single()
  if (error || !existing) {
    throw new Error(`Failed to reconcile Aurora ${input.operation} mutation`)
  }
  return { job: existing, claimed: false }
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/test-only/siteforge/aurora-lifecycle/provider-operations'
  )
  ctx.logStart()
  try {
    const identity = requireAuroraLifecycleIdentity(request)
    const parsed = requestSchema.safeParse(await request.json())
    if (
      !parsed.success ||
      parsed.data.propertyId !== identity.propertyId ||
      parsed.data.websiteId !== identity.websiteId
    ) {
      throw new AuroraLifecycleControlError(
        'Invalid exact Aurora provider operation request',
        400,
        'invalid_request'
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new AuroraLifecycleControlError('Unauthorized', 401, 'unauthorized')
    }
    const access = await validatePropertyManagerAccess(
      user.id,
      identity.propertyId
    )
    if (!access.authorized) {
      throw new AuroraLifecycleControlError(
        'Aurora lifecycle manager permission required',
        403,
        'forbidden'
      )
    }
    const bootstrapOperation = ['start_backup', 'poll_backup'].includes(
      parsed.data.operation
    )
    const client = createServiceClient()
    await assertActiveAuroraLifecycleLease(
      request,
      identity,
      client,
      bootstrapOperation ? 'bootstrap' : 'mutation'
    )
    const cloudwaysCredentials = getCloudwaysProviderCredentials()
    if (!cloudwaysCredentials) {
      throw new AuroraLifecycleControlError(
        'Cloudways API credentials are required',
        503,
        'provider_unavailable'
      )
    }
    const [
      { data: lease, error: leaseError },
      { data: targets, error: targetsError },
    ] = await Promise.all([
      client
        .from('shared_jobs')
        .select('id, output')
        .eq('domain', AURORA_LIFECYCLE_DOMAIN)
        .eq('subject_id', identity.websiteId)
        .eq('lease_owner', identity.ownerId)
        .single(),
      client
        .from('siteforge_wordpress_targets')
        .select(
          'id, org_id, target_type, provider, provider_application_id, provider_parent_application_id, provider_server_id'
        )
        .eq('website_id', identity.websiteId)
        .eq('is_active', true)
        .in('target_type', ['staging', 'production']),
    ])
    if (leaseError || !lease || targetsError) {
      throw new AuroraLifecycleControlError(
        'Aurora provider bootstrap state is unavailable',
        409,
        'provider_state_missing'
      )
    }
    const output = record(lease.output)
    const production = targets?.find(
      (target) =>
        target.target_type === 'production' &&
        target.id === output.productionTargetId
    )
    const staging = targets?.find(
      (target) =>
        target.target_type === 'staging' && target.id === output.stagingTargetId
    )
    if (
      production?.provider !== 'cloudways' ||
      staging?.provider !== 'cloudways' ||
      !production.provider_application_id ||
      !production.provider_server_id ||
      !staging.provider_application_id ||
      staging.provider_parent_application_id !==
        production.provider_application_id ||
      staging.provider_server_id !== production.provider_server_id
    ) {
      throw new AuroraLifecycleControlError(
        'Exact owned Cloudways production and staging targets are required',
        409,
        'provider_target_mismatch'
      )
    }
    const provider = new CloudwaysProviderClient(cloudwaysCredentials)
    let response: Record<string, unknown>

    if (parsed.data.operation === 'start_backup') {
      if (
        typeof output.rollbackArtifactId !== 'string' ||
        typeof output.startArtifactId !== 'string'
      ) {
        throw new AuroraLifecycleControlError(
          'Certified rollback and v3 start artifacts are required before backup',
          409,
          'bootstrap_baseline_missing'
        )
      }
      if (
        typeof output.backupOperationId === 'string' &&
        typeof output.backupId === 'string'
      ) {
        response = {
          operation: parsed.data.operation,
          operationId: output.backupOperationId,
          backupId: output.backupId,
          idempotent: true,
        }
      } else {
        const claim = await claimProviderMutation(client, {
          orgId: production.org_id,
          propertyId: identity.propertyId,
          websiteId: identity.websiteId,
          ownerId: identity.ownerId,
          expiresAt: identity.expiresAt,
          operation: 'backup',
        })
        if (!claim.claimed) {
          const checkpoint = record(claim.job.output)
          if (
            typeof checkpoint.operationId === 'string' &&
            typeof checkpoint.backupId === 'string'
          ) {
            const { error } = await client
              .from('shared_jobs')
              .update({
                output: {
                  ...output,
                  backupOperationId: checkpoint.operationId,
                  backupId: checkpoint.backupId,
                },
                updated_at: new Date().toISOString(),
              })
              .eq('id', lease.id)
              .eq('lease_owner', identity.ownerId)
            if (error) throw new Error('Failed to reconcile backup checkpoint')
            response = {
              operation: parsed.data.operation,
              operationId: checkpoint.operationId,
              backupId: checkpoint.backupId,
              idempotent: true,
            }
            ctx.logSuccess(200, {
              websiteId: identity.websiteId,
              operation: parsed.data.operation,
            })
            return NextResponse.json(response, {
              headers: ctx.responseHeaders,
            })
          }
          throw new AuroraLifecycleControlError(
            'Backup mutation was claimed without a persisted provider identity; manual reconciliation is required',
            409,
            'provider_reconciliation_required'
          )
        }
        const started = await provider.createApplicationBackup({
          serverId: production.provider_server_id,
          applicationId: production.provider_application_id,
        })
        if (!started.operationId) {
          throw new Error(
            'Cloudways did not return the exact backup operation identity'
          )
        }
        // Cloudways identifies backups by restore-point timestamps, revealed
        // only after the backup operation completes.
        await provider.waitForOperation(started.operationId)
        const restorePoint = await provider.getLatestRestorePoint({
          serverId: production.provider_server_id,
          applicationId: production.provider_application_id,
        })
        if (!restorePoint) {
          throw new Error(
            'Cloudways did not reveal the restore point for the completed backup'
          )
        }
        const backup = { operationId: started.operationId, backupId: restorePoint }
        const { error: checkpointError } = await client
          .from('shared_jobs')
          .update({
            lifecycle_status: 'succeeded',
            status_reason: 'aurora_backup_provider_identity_persisted',
            output: {
              operationId: backup.operationId,
              backupId: backup.backupId,
            },
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', claim.job.id)
          .eq('lease_owner', identity.ownerId)
        if (checkpointError) {
          throw new Error('Failed to checkpoint Cloudways backup identity')
        }
        const { error } = await client
          .from('shared_jobs')
          .update({
            output: {
              ...output,
              backupOperationId: backup.operationId,
              backupId: backup.backupId,
              backupStartedAt: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', lease.id)
          .eq('lease_owner', identity.ownerId)
        if (error)
          throw new Error('Failed to persist Cloudways backup identity')
        response = {
          operation: parsed.data.operation,
          operationId: backup.operationId,
          backupId: backup.backupId,
          idempotent: false,
        }
      }
    } else if (parsed.data.operation === 'poll_backup') {
      if (
        typeof output.backupOperationId !== 'string' ||
        typeof output.backupId !== 'string'
      ) {
        throw new AuroraLifecycleControlError(
          'No owned Cloudways backup operation is recorded',
          409,
          'backup_identity_missing'
        )
      }
      await provider.verifyOperation(output.backupOperationId, {
        kind: 'backup',
        serverId: production.provider_server_id,
        applicationId: production.provider_application_id,
        backupId: output.backupId,
      })
      const verifiedAt = new Date().toISOString()
      const { error } = await client
        .from('shared_jobs')
        .update({
          output: { ...output, backupVerifiedAt: verifiedAt },
          updated_at: verifiedAt,
        })
        .eq('id', lease.id)
        .eq('lease_owner', identity.ownerId)
      if (error) throw new Error('Failed to persist verified backup identity')
      response = {
        operation: parsed.data.operation,
        operationId: output.backupOperationId,
        backupId: output.backupId,
        verified: true,
      }
    } else {
      const { data: release, error: releaseError } = await client
        .from('siteforge_launch_releases')
        .select('id, backup_id, backup_operation_id, promotion_operation_id')
        .eq('id', parsed.data.releaseId)
        .eq('property_id', identity.propertyId)
        .eq('website_id', identity.websiteId)
        .single()
      if (releaseError || !release) {
        throw new AuroraLifecycleControlError(
          'Exact Aurora launch release was not found',
          404,
          'release_not_found'
        )
      }
      if (parsed.data.operation === 'start_promotion') {
        if (typeof output.promotionOperationId === 'string') {
          response = {
            operation: parsed.data.operation,
            releaseId: release.id,
            operationId: output.promotionOperationId,
            idempotent: true,
          }
        } else {
          const claim = await claimProviderMutation(client, {
            orgId: production.org_id,
            propertyId: identity.propertyId,
            websiteId: identity.websiteId,
            ownerId: identity.ownerId,
            expiresAt: identity.expiresAt,
            operation: 'promotion',
            releaseId: release.id,
          })
          if (!claim.claimed) {
            const checkpoint = record(claim.job.output)
            if (typeof checkpoint.operationId !== 'string') {
              throw new AuroraLifecycleControlError(
                'Promotion mutation was claimed without a persisted provider identity; manual reconciliation is required',
                409,
                'provider_reconciliation_required'
              )
            }
            response = {
              operation: parsed.data.operation,
              releaseId: release.id,
              operationId: checkpoint.operationId,
              idempotent: true,
            }
          } else {
            const started = await provider.promoteStagingApplication({
              serverId: production.provider_server_id,
              stagingApplicationId: staging.provider_application_id,
              productionApplicationId: production.provider_application_id,
            })
            if (!started.operationId) {
              throw new Error(
                'Cloudways did not return the exact promotion operation identity'
              )
            }
            await provider.waitForOperation(started.operationId)
            const completedAt = new Date().toISOString()
            const { error: checkpointError } = await client
              .from('shared_jobs')
              .update({
                lifecycle_status: 'succeeded',
                status_reason: 'aurora_promotion_provider_identity_persisted',
                output: { operationId: started.operationId },
                finished_at: completedAt,
                updated_at: completedAt,
              })
              .eq('id', claim.job.id)
              .eq('lease_owner', identity.ownerId)
            if (checkpointError) {
              throw new Error(
                'Failed to checkpoint Cloudways promotion identity'
              )
            }
            const { error } = await client
              .from('shared_jobs')
              .update({
                output: {
                  ...output,
                  promotionOperationId: started.operationId,
                  promotionCompletedAt: completedAt,
                },
                updated_at: completedAt,
              })
              .eq('id', lease.id)
              .eq('lease_owner', identity.ownerId)
            if (error) {
              throw new Error('Failed to persist Cloudways promotion identity')
            }
            response = {
              operation: parsed.data.operation,
              releaseId: release.id,
              operationId: started.operationId,
              idempotent: false,
            }
          }
        }
      } else if (parsed.data.operation === 'verify_promotion') {
        if (!release.promotion_operation_id) {
          throw new AuroraLifecycleControlError(
            'Promotion has not created an owned provider operation',
            409,
            'promotion_identity_missing'
          )
        }
        await provider.verifyOperation(release.promotion_operation_id, {
          kind: 'promotion',
          serverId: production.provider_server_id,
          applicationId: production.provider_application_id,
          stagingApplicationId: staging.provider_application_id,
        })
        response = {
          operation: parsed.data.operation,
          releaseId: release.id,
          operationId: release.promotion_operation_id,
          verified: true,
        }
      } else if (parsed.data.operation === 'start_restore') {
        const backupId = release.backup_id || output.backupId
        if (typeof backupId !== 'string') {
          throw new AuroraLifecycleControlError(
            'No verified owned backup is available for restore',
            409,
            'backup_identity_missing'
          )
        }
        if (typeof output.restoreOperationId === 'string') {
          response = {
            operation: parsed.data.operation,
            operationId: output.restoreOperationId,
            backupId,
            idempotent: true,
          }
        } else {
          const claim = await claimProviderMutation(client, {
            orgId: production.org_id,
            propertyId: identity.propertyId,
            websiteId: identity.websiteId,
            ownerId: identity.ownerId,
            expiresAt: identity.expiresAt,
            operation: 'restore',
            releaseId: release.id,
          })
          if (!claim.claimed) {
            const checkpoint = record(claim.job.output)
            if (typeof checkpoint.operationId === 'string') {
              const { error } = await client
                .from('shared_jobs')
                .update({
                  output: {
                    ...output,
                    restoreOperationId: checkpoint.operationId,
                    restoreBackupId: backupId,
                    restoreReleaseId: release.id,
                  },
                  updated_at: new Date().toISOString(),
                })
                .eq('id', lease.id)
                .eq('lease_owner', identity.ownerId)
              if (error)
                throw new Error('Failed to reconcile restore checkpoint')
              response = {
                operation: parsed.data.operation,
                operationId: checkpoint.operationId,
                backupId,
                idempotent: true,
              }
              ctx.logSuccess(200, {
                websiteId: identity.websiteId,
                operation: parsed.data.operation,
              })
              return NextResponse.json(response, {
                headers: ctx.responseHeaders,
              })
            }
            throw new AuroraLifecycleControlError(
              'Restore mutation was claimed without a persisted provider identity; manual reconciliation is required',
              409,
              'provider_reconciliation_required'
            )
          }
          const started = await provider.restoreApplicationBackup({
            serverId: production.provider_server_id,
            applicationId: production.provider_application_id,
            backupId,
          })
          if (!started.operationId) {
            throw new Error(
              'Cloudways did not return an exact restore operation'
            )
          }
          const { error: checkpointError } = await client
            .from('shared_jobs')
            .update({
              lifecycle_status: 'succeeded',
              status_reason: 'aurora_restore_provider_identity_persisted',
              output: {
                operationId: started.operationId,
                backupId,
                releaseId: release.id,
              },
              finished_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', claim.job.id)
            .eq('lease_owner', identity.ownerId)
          if (checkpointError) {
            throw new Error('Failed to checkpoint Cloudways restore identity')
          }
          const { error } = await client
            .from('shared_jobs')
            .update({
              output: {
                ...output,
                restoreOperationId: started.operationId,
                restoreBackupId: backupId,
                restoreReleaseId: release.id,
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', lease.id)
            .eq('lease_owner', identity.ownerId)
          if (error)
            throw new Error('Failed to persist restore operation identity')
          response = {
            operation: parsed.data.operation,
            operationId: started.operationId,
            backupId,
            idempotent: false,
          }
        }
      } else {
        if (
          typeof output.restoreOperationId !== 'string' ||
          typeof output.restoreBackupId !== 'string' ||
          output.restoreReleaseId !== release.id
        ) {
          throw new AuroraLifecycleControlError(
            'No exact owned restore operation is recorded',
            409,
            'restore_identity_missing'
          )
        }
        await provider.verifyOperation(output.restoreOperationId, {
          kind: 'restore',
          serverId: production.provider_server_id,
          applicationId: production.provider_application_id,
          backupId: output.restoreBackupId,
        })
        const verifiedAt = new Date().toISOString()
        const { error } = await client
          .from('shared_jobs')
          .update({
            output: { ...output, restoreVerifiedAt: verifiedAt },
            updated_at: verifiedAt,
          })
          .eq('id', lease.id)
          .eq('lease_owner', identity.ownerId)
        if (error) throw new Error('Failed to persist restore verification')
        response = {
          operation: parsed.data.operation,
          releaseId: release.id,
          operationId: output.restoreOperationId,
          verified: true,
        }
      }
    }
    ctx.logSuccess(200, {
      websiteId: identity.websiteId,
      operation: parsed.data.operation,
    })
    return NextResponse.json(response, { headers: ctx.responseHeaders })
  } catch (error) {
    const response = controlledError(error, ctx.responseHeaders)
    ctx.logError(response.status, error)
    return response
  }
}
