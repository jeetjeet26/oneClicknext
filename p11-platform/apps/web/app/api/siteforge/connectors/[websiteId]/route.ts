import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  createConnectorConfig,
  listConnectorConfigs,
  SiteForgeConnectorError,
} from '@/utils/siteforge/connectors/repository'

async function authorize(propertyId: string, requireManager = false) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Unauthorized' as const, status: 401 }
  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized) return { error: 'Forbidden' as const, status: 403 }
  if (requireManager) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!profile || !['admin', 'manager'].includes(profile.role || '')) {
      return {
        error: 'Connector configuration permission required' as const,
        status: 403,
      }
    }
  }
  return { user }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/connectors/[websiteId]'
  )
  ctx.logStart()
  try {
    const { websiteId } = await params
    const propertyId = request.nextUrl.searchParams.get('propertyId')
    if (
      !z.string().uuid().safeParse(websiteId).success ||
      !z.guid().safeParse(propertyId).success
    ) {
      return NextResponse.json(
        { error: 'Invalid connector scope' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await authorize(propertyId!)
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: ctx.responseHeaders }
      )
    }
    const connectors = await listConnectorConfigs(websiteId, propertyId!)
    ctx.logSuccess(200, { websiteId, count: connectors.length })
    return NextResponse.json({ connectors }, { headers: ctx.responseHeaders })
  } catch (error) {
    const status =
      error instanceof SiteForgeConnectorError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof SiteForgeConnectorError
            ? error.message
            : 'Failed to load connectors',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/connectors/[websiteId]'
  )
  ctx.logStart()
  try {
    const { websiteId } = await params
    if (!z.string().uuid().safeParse(websiteId).success) {
      return NextResponse.json(
        { error: 'Invalid website identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const body: unknown = await request.json()
    const propertyId =
      body && typeof body === 'object' && 'propertyId' in body
        ? (body as { propertyId?: unknown }).propertyId
        : null
    if (!z.guid().safeParse(propertyId).success) {
      return NextResponse.json(
        { error: 'Invalid property identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await authorize(String(propertyId), true)
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: ctx.responseHeaders }
      )
    }
    const connector = await createConnectorConfig({
      websiteId,
      userId: auth.user.id,
      config: body,
    })
    ctx.logSuccess(201, { websiteId, connectorId: connector.id })
    return NextResponse.json(
      { success: true, connector },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    const validation = error instanceof z.ZodError
    const status = validation
      ? 400
      : error instanceof SiteForgeConnectorError
        ? error.statusCode
        : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error: validation
          ? 'Invalid connector config'
          : error instanceof SiteForgeConnectorError
            ? error.message
            : 'Failed to create connector config',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
