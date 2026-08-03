import { NextRequest, NextResponse } from 'next/server'
import { unauthorized, validateCronAuth } from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'
import { createServiceClient } from '@/utils/supabase/admin'
import { createSiteForgeHandlerRegistry } from '@/utils/siteforge/operations/handlers'
import { processSiteForgeOutbox } from '@/utils/siteforge/operations/outbox'

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/siteforge-outbox')
  ctx.logStart()
  if (validateCronAuth(request)) {
    ctx.logSuccess(401, { reason: 'invalid_cron_secret' })
    return unauthorized(ctx.responseHeaders)
  }
  try {
    const workerId = `siteforge-outbox:${ctx.requestId}`
    const result = await processSiteForgeOutbox(
      createServiceClient(),
      createSiteForgeHandlerRegistry(),
      { workerId }
    )
    ctx.logSuccess(200, result)
    return NextResponse.json({ success: true, ...result }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'process_siteforge_outbox' })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Outbox processing failed' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
