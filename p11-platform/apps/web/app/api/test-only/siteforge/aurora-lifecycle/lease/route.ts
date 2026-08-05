import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  acquireOrRenewAuroraLifecycleLease,
  AuroraLifecycleControlError,
  releaseAuroraLifecycleLease,
  requireAuroraLifecycleIdentity,
  transitionAuroraLifecycleToMutation,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'

const leaseSchema = z
  .object({
    operation: z.enum(['acquire', 'renew', 'activate_mutation']),
    propertyId: z.string().uuid(),
    websiteId: z.string().uuid(),
    targetId: z.string().uuid(),
    rolloutAssignmentId: z.string().uuid(),
    ownerId: z.string().uuid(),
    expiresAt: z.string().datetime(),
  })
  .strict()

const releaseSchema = z
  .object({
    confirmation: z.literal('RELEASE_OWNED_AURORA_LEASE'),
  })
  .strict()

async function requireManager(propertyId: string) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    throw new AuroraLifecycleControlError('Unauthorized', 401, 'unauthorized')
  }
  const access = await validatePropertyManagerAccess(user.id, propertyId)
  if (!access.authorized) {
    throw new AuroraLifecycleControlError(
      'Aurora lifecycle manager permission required',
      403,
      'forbidden'
    )
  }
  return user
}

function errorResponse(
  error: unknown,
  headers: Record<string, string>
): NextResponse {
  const status =
    error instanceof AuroraLifecycleControlError ? error.statusCode : 500
  return NextResponse.json(
    {
      error:
        status === 500
          ? 'Aurora lifecycle lease operation failed'
          : (error as Error).message,
      code:
        error instanceof AuroraLifecycleControlError
          ? error.code
          : 'lease_operation_failed',
    },
    { status, headers }
  )
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/test-only/siteforge/aurora-lifecycle/lease'
  )
  ctx.logStart()
  try {
    const identity = requireAuroraLifecycleIdentity(request)
    const parsed = leaseSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw new AuroraLifecycleControlError(
        'Invalid Aurora lifecycle lease request',
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
          `Aurora lifecycle ${key} must match the exact identity header`,
          409,
          'request_identity_mismatch'
        )
      }
    }
    const user = await requireManager(identity.propertyId)
    const lease =
      parsed.data.operation === 'activate_mutation'
        ? await transitionAuroraLifecycleToMutation(identity)
        : await acquireOrRenewAuroraLifecycleLease(
            identity,
            user.id,
            parsed.data.operation
          )
    ctx.logSuccess(200, {
      ownerId: identity.ownerId,
      websiteId: identity.websiteId,
      operation: parsed.data.operation,
    })
    return NextResponse.json(
      {
        lease: {
          id: lease.id,
          ownerId: lease.lease_owner,
          expiresAt: lease.lease_expires_at,
          status: lease.lifecycle_status,
          phase:
            lease.output &&
            typeof lease.output === 'object' &&
            !Array.isArray(lease.output) &&
            lease.output.phase === 'mutation'
              ? 'mutation'
              : 'bootstrap',
        },
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const response = errorResponse(error, ctx.responseHeaders)
    ctx.logError(response.status, error)
    return response
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/test-only/siteforge/aurora-lifecycle/lease'
  )
  ctx.logStart()
  try {
    const identity = requireAuroraLifecycleIdentity(request)
    const parsed = releaseSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw new AuroraLifecycleControlError(
        'Explicit Aurora lease release confirmation is required',
        400,
        'invalid_confirmation'
      )
    }
    await requireManager(identity.propertyId)
    await releaseAuroraLifecycleLease(identity)
    ctx.logSuccess(200, {
      ownerId: identity.ownerId,
      websiteId: identity.websiteId,
    })
    return NextResponse.json(
      { released: true },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const response = errorResponse(error, ctx.responseHeaders)
    ctx.logError(response.status, error)
    return response
  }
}
