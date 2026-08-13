import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { connectorCommandSchema } from '@/utils/siteforge/connectors/contracts'
import {
  recordConnectorCheckpoint,
  recordConnectorReconciliation,
  SiteForgeConnectorError,
} from '@/utils/siteforge/connectors/repository'

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ websiteId: string; connectorId: string }>
  }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/connectors/[websiteId]/[connectorId]'
  )
  ctx.logStart()
  try {
    const { websiteId, connectorId } = await params
    if (
      !z.string().uuid().safeParse(websiteId).success ||
      !z.string().uuid().safeParse(connectorId).success
    ) {
      return NextResponse.json(
        { error: 'Invalid connector identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const parsed = connectorCommandSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid connector command' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!profile || !['admin', 'manager'].includes(profile.role || '')) {
      return NextResponse.json(
        { error: 'Connector operations permission required' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }

    let connector
    if (parsed.data.action !== 'reconcile') {
      connector = await recordConnectorCheckpoint({
        connectorId,
        websiteId,
        propertyId: parsed.data.propertyId,
      })
    } else {
      connector = await recordConnectorReconciliation({
        connectorId,
        websiteId,
        propertyId: parsed.data.propertyId,
      })
    }
    ctx.logSuccess(200, {
      websiteId,
      connectorId,
      action: parsed.data.action,
    })
    return NextResponse.json(
      { success: true, connector },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof SiteForgeConnectorError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof SiteForgeConnectorError
            ? error.message
            : 'Failed to execute connector command',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
