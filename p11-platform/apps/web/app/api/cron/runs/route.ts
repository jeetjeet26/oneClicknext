import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createRequestContext } from '@/utils/services/request-context'
import {
  badRequest,
  forbidden,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { listRecentCronJobRuns } from '@/utils/services/cron-job-runs'

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/runs')
  ctx.logStart()

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    ctx.logError(500, profileError, { operation: 'load_profile_for_cron_runs_visibility' })
    return serverError(profileError, ctx.responseHeaders)
  }

  if (!['admin', 'manager'].includes(profile.role || '')) {
    ctx.logSuccess(403, { reason: 'insufficient_role_for_cron_runs', userId: user.id })
    return forbidden(ctx.responseHeaders)
  }

  const { searchParams } = new URL(request.url)
  const limitParam = searchParams.get('limit')
  const jobName = searchParams.get('jobName')
  const status = searchParams.get('status')

  const limit = limitParam ? Number(limitParam) : 20
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    ctx.logSuccess(400, { reason: 'invalid_limit', limitParam })
    return badRequest('limit must be an integer between 1 and 100', ctx.responseHeaders)
  }

  try {
    const runs = await listRecentCronJobRuns({
      limit,
      jobName,
      status,
    })

    ctx.logSuccess(200, {
      count: runs.length,
      jobName: jobName || undefined,
      status: status || undefined,
    })

    return NextResponse.json(
      {
        success: true,
        runs,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'list_cron_job_runs' })
    return serverError(error, ctx.responseHeaders)
  }
}
