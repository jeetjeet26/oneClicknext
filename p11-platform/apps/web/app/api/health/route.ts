import { NextRequest, NextResponse } from 'next/server'
import { buildHealthReport } from '@/utils/health'
import { createRequestContext } from '@/utils/services/request-context'

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/health')
  ctx.logStart()

  try {
    const report = await buildHealthReport()
    const statusCode = report.status === 'unhealthy' ? 503 : 200

    ctx.logSuccess(statusCode, { healthStatus: report.status })

    return NextResponse.json(report, {
      status: statusCode,
      headers: ctx.responseHeaders,
    })
  } catch (error) {
    ctx.logError(500, error)

    return NextResponse.json(
      {
        status: 'unhealthy',
        error: 'Health check failed',
      },
      {
        status: 500,
        headers: ctx.responseHeaders,
      }
    )
  }
}
