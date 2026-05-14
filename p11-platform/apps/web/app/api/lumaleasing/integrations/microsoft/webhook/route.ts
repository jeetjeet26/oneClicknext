import { NextRequest, NextResponse } from 'next/server'
import { createRequestContext } from '@/utils/services/request-context'

function acknowledge(headers: Record<string, string>, details: Record<string, unknown> = {}) {
  return NextResponse.json({ success: true, ...details }, { headers })
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/integrations/microsoft/webhook')
  ctx.logStart()

  const validationToken = request.nextUrl.searchParams.get('validationToken')
  if (validationToken) {
    ctx.logSuccess(200, { validation: true })
    return new NextResponse(validationToken, {
      status: 200,
      headers: {
        ...ctx.responseHeaders,
        'Content-Type': 'text/plain',
      },
    })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const notifications = Array.isArray(body?.value) ? body.value.length : 0
    ctx.logSuccess(202, { notifications })
    return acknowledge(ctx.responseHeaders, { accepted: true, notifications })
  } catch (error) {
    ctx.logError(202, error, { operation: 'microsoft_webhook_acknowledge' })
    return acknowledge(ctx.responseHeaders, { accepted: true })
  }
}
