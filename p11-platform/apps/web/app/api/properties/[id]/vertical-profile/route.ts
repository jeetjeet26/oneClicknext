import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  validatePropertyAccess,
  validatePropertyManagerAccess,
} from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { createPropertyVerticalProfileSchema } from '@/utils/real-estate/contracts'
import {
  createPropertyVerticalProfileVersion,
  getCurrentPropertyVerticalProfile,
  PropertyVerticalProfileError,
} from '@/utils/real-estate/repository'

async function authenticatedUser() {
  const client = await createClient()
  const {
    data: { user },
    error,
  } = await client.auth.getUser()
  return error ? null : user
}

function errorResponse(
  error: unknown,
  headers: Record<string, string>,
  fallback: string
) {
  const status =
    error instanceof PropertyVerticalProfileError ? error.statusCode : 500
  return NextResponse.json(
    {
      error:
        error instanceof PropertyVerticalProfileError ? error.message : fallback,
    },
    { status, headers }
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/properties/[id]/vertical-profile'
  )
  ctx.logStart()
  const { id: propertyId } = await params
  const user = await authenticatedUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: ctx.responseHeaders }
    )
  }
  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized || !access.orgId) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: ctx.responseHeaders }
    )
  }

  try {
    const profile = await getCurrentPropertyVerticalProfile({
      orgId: access.orgId,
      propertyId,
    })
    ctx.logSuccess(200, {
      propertyId,
      profileVersion: profile.version,
      mappingStatus: profile.mappingStatus,
    })
    return NextResponse.json({ profile }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(
      error instanceof PropertyVerticalProfileError ? error.statusCode : 500,
      error
    )
    return errorResponse(
      error,
      ctx.responseHeaders,
      'Failed to load vertical profile'
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/properties/[id]/vertical-profile'
  )
  ctx.logStart()
  const { id: propertyId } = await params
  const user = await authenticatedUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: ctx.responseHeaders }
    )
  }
  const access = await validatePropertyManagerAccess(user.id, propertyId)
  if (!access.authorized || !access.orgId) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: ctx.responseHeaders }
    )
  }

  const parsed = createPropertyVerticalProfileSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid vertical profile', issues: parsed.error.issues },
      { status: 400, headers: ctx.responseHeaders }
    )
  }

  try {
    const result = await createPropertyVerticalProfileVersion({
      orgId: access.orgId,
      propertyId,
      userId: user.id,
      value: parsed.data,
    })
    const status = result.reused ? 200 : 201
    ctx.logSuccess(status, {
      propertyId,
      profileVersion: result.profile.version,
      reused: result.reused,
    })
    return NextResponse.json(result, {
      status,
      headers: ctx.responseHeaders,
    })
  } catch (error) {
    ctx.logError(
      error instanceof PropertyVerticalProfileError ? error.statusCode : 500,
      error
    )
    return errorResponse(
      error,
      ctx.responseHeaders,
      'Failed to create vertical profile'
    )
  }
}
