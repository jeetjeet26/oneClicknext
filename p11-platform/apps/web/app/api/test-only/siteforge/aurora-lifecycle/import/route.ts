import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Json } from '@/types/supabase'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { bootstrapAuroraArtifacts } from '@/utils/siteforge/testing/aurora-lifecycle-bootstrap'
import {
  assertActiveAuroraLifecycleLease,
  AuroraLifecycleControlError,
  loadExactAuroraIdentity,
  postgresUuidSchema,
  requireAuroraLifecycleIdentity,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'

export const maxDuration = 600

const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const importSchema = z
  .object({
    operation: z.literal('import_immutable_rollback_baseline'),
    propertyId: postgresUuidSchema,
    websiteId: postgresUuidSchema,
    targetId: postgresUuidSchema,
    rolloutAssignmentId: postgresUuidSchema,
    runtimePackageSha256: sha256,
    runtimeManifestSha256: sha256,
    baseThemePackageSha256: sha256,
    runtimeSigningKeyId: z.string().trim().min(1).max(200),
    ownerId: postgresUuidSchema,
    expiresAt: z.string().datetime(),
  })
  .strict()

function controlledError(error: unknown, headers: Record<string, string>) {
  const status =
    error instanceof AuroraLifecycleControlError ? error.statusCode : 500
  return NextResponse.json(
    {
      error:
        status === 500
          ? 'Failed to bootstrap the exact Aurora rollback baseline'
          : (error as Error).message,
      code:
        error instanceof AuroraLifecycleControlError
          ? error.code
          : 'baseline_import_failed',
    },
    { status, headers }
  )
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/test-only/siteforge/aurora-lifecycle/import'
  )
  ctx.logStart()
  try {
    const identity = requireAuroraLifecycleIdentity(request)
    const parsed = importSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw new AuroraLifecycleControlError(
        'Invalid exact Aurora bootstrap import request',
        400,
        'invalid_request'
      )
    }
    for (const key of [
      'propertyId',
      'websiteId',
      'targetId',
      'rolloutAssignmentId',
      'ownerId',
      'expiresAt',
    ] as const) {
      if (parsed.data[key] !== identity[key]) {
        throw new AuroraLifecycleControlError(
          `Aurora lifecycle ${key} does not match its identity header`,
          409,
          'request_identity_mismatch'
        )
      }
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new AuroraLifecycleControlError(
        'Unauthorized',
        401,
        'unauthorized'
      )
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
    const client = createServiceClient()
    await loadExactAuroraIdentity(identity, client, 'bootstrap')
    await assertActiveAuroraLifecycleLease(
      request,
      identity,
      client,
      'bootstrap'
    )
    const imported = await bootstrapAuroraArtifacts({
      identity,
      actorId: user.id,
      runtimePackageSha256: parsed.data.runtimePackageSha256,
      runtimeManifestSha256: parsed.data.runtimeManifestSha256,
      baseThemePackageSha256: parsed.data.baseThemePackageSha256,
      runtimeSigningKeyId: parsed.data.runtimeSigningKeyId,
      client,
    })
    const { error: auditError } = await client.from('mcp_audit_log').insert({
      platform: 'siteforge-aurora-lifecycle',
      tool_name: 'bootstrap_immutable_rollback_baseline',
      operation_type: 'siteforge_aurora_baseline_import',
      property_id: identity.propertyId,
      parameters: {
        ownerId: identity.ownerId,
        websiteId: identity.websiteId,
        targetId: identity.targetId,
        rolloutAssignmentId: identity.rolloutAssignmentId,
        rollbackArtifactId: imported.rollbackArtifactId,
        startArtifactId: imported.startArtifactId,
        requestId: ctx.requestId,
      } as Json,
      success: true,
    })
    if (auditError) throw new Error('Failed to persist Aurora bootstrap audit')
    ctx.logSuccess(200, {
      websiteId: identity.websiteId,
      targetId: identity.targetId,
      ...imported,
    })
    return NextResponse.json(
      {
        imported: true,
        idempotent: imported.idempotent,
        currentArtifact: {
          id: imported.startArtifactId,
          contentHash: imported.startContentHash,
        },
        rollbackBaseline: {
          id: imported.rollbackArtifactId,
          contentHash: imported.rollbackContentHash,
          remoteVerified: true,
        },
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const response = controlledError(error, ctx.responseHeaders)
    ctx.logError(response.status, error)
    return response
  }
}
