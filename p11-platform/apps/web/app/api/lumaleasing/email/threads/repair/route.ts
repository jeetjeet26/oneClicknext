import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  badRequest,
  forbidden,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const OVERDUE_DAYS = 2

const ThreadRepairSchema = z.object({
  propertyId: z.string().min(1),
  action: z.enum(['resolve_overdue_internal_replies']),
})

type RepairableThread = {
  id: string
  lead_id: string | null
  last_message_at: string | null
}

function isOverdue(lastMessageAt: string | null, nowMs: number): boolean {
  if (!lastMessageAt) {
    return false
  }
  const parsed = Date.parse(lastMessageAt)
  if (!Number.isFinite(parsed)) {
    return false
  }
  return nowMs - parsed >= OVERDUE_DAYS * MS_PER_DAY
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/email/threads/repair')
  ctx.logStart()

  try {
    const body = await request.json()
    const parsed = ThreadRepairSchema.safeParse(body)
    if (!parsed.success) {
      ctx.logSuccess(400, { reason: 'invalid_request_body' })
      return badRequest('Invalid thread repair request', ctx.responseHeaders)
    }

    const { propertyId } = parsed.data

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const serviceSupabase = createServiceClient()
    const { data: config, error: configError } = await serviceSupabase
      .from('email_configurations')
      .select('id')
      .eq('property_id', propertyId)
      .eq('sync_enabled', true)
      .maybeSingle()

    if (configError || !config?.id) {
      ctx.logSuccess(400, { reason: 'email_not_connected', propertyId })
      return badRequest('Gmail must be connected before lifecycle repair', ctx.responseHeaders)
    }

    const { data: threadRows, error: threadError } = await serviceSupabase
      .from('email_threads')
      .select('id, lead_id, last_message_at')
      .eq('email_configuration_id', config.id)
      .eq('status', 'awaiting_internal_reply')
      .order('last_message_at', { ascending: true })
      .limit(500)

    if (threadError) {
      ctx.logError(500, threadError, { operation: 'load_repair_threads', propertyId })
      return serverError(threadError, ctx.responseHeaders)
    }

    const nowMs = Date.now()
    const overdueThreads = ((threadRows || []) as RepairableThread[]).filter((thread) =>
      isOverdue(thread.last_message_at, nowMs)
    )

    if (overdueThreads.length === 0) {
      ctx.logSuccess(200, {
        propertyId,
        scanned: (threadRows || []).length,
        repaired: 0,
      })
      return NextResponse.json(
        {
          success: true,
          scanned: (threadRows || []).length,
          repaired: 0,
          repairedThreadIds: [],
        },
        { headers: ctx.responseHeaders }
      )
    }

    const overdueThreadIds = overdueThreads.map((thread) => thread.id)
    const { error: updateError } = await serviceSupabase
      .from('email_threads')
      .update({ status: 'resolved' })
      .in('id', overdueThreadIds)

    if (updateError) {
      ctx.logError(500, updateError, { operation: 'update_overdue_threads', propertyId })
      return serverError(updateError, ctx.responseHeaders)
    }

    const activities = overdueThreads
      .filter((thread) => Boolean(thread.lead_id))
      .map((thread) => ({
        lead_id: thread.lead_id as string,
        type: 'email_thread_status_updated',
        description: `Thread auto-resolved from overdue internal reply queue`,
        metadata: {
          email_thread_id: thread.id,
          previous_status: 'awaiting_internal_reply',
          new_status: 'resolved',
          repair_action: 'resolve_overdue_internal_replies',
        },
      }))

    if (activities.length > 0) {
      await serviceSupabase.from('lead_activities').insert(activities)
    }

    ctx.logSuccess(200, {
      propertyId,
      scanned: (threadRows || []).length,
      repaired: overdueThreadIds.length,
    })
    return NextResponse.json(
      {
        success: true,
        scanned: (threadRows || []).length,
        repaired: overdueThreadIds.length,
        repairedThreadIds: overdueThreadIds,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'repair_overdue_threads' })
    return serverError(error, ctx.responseHeaders)
  }
}
