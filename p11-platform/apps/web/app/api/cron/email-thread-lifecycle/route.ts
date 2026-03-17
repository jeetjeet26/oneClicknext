import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
import { createRequestContext } from '@/utils/services/request-context'
import { unauthorized, validateCronAuth } from '@/utils/services/api-helpers'

type ThreadRow = {
  id: string
  lead_id: string | null
  property_id: string | null
  last_message_at: string | null
}

type LeadActivityRow = {
  metadata: Record<string, unknown> | null
}

const DEFAULT_AWAITING_LEAD_REPLY_STALE_DAYS = 7
const DEFAULT_AWAITING_INTERNAL_REPLY_OVERDUE_DAYS = 2
const MAX_STALE_DAYS = 90
const MIN_STALE_DAYS = 1

function parseDays(value: string | null, fallback: number): number {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(MAX_STALE_DAYS, Math.max(MIN_STALE_DAYS, parsed))
}

function buildEscalationKey(threadId: string, lastMessageAt: string | null): string {
  return `${threadId}:${lastMessageAt || 'unknown'}`
}

function extractEscalationKey(row: LeadActivityRow): string | null {
  const metadata =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata
      : null

  const threadId = typeof metadata?.email_thread_id === 'string' ? metadata.email_thread_id : null
  const lastMessageAt =
    typeof metadata?.last_message_at === 'string' ? metadata.last_message_at : 'unknown'

  if (!threadId) {
    return null
  }

  return buildEscalationKey(threadId, lastMessageAt)
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/email-thread-lifecycle')
  ctx.logStart()

  const authError = validateCronAuth(request)
  if (authError) {
    ctx.logSuccess(401, { reason: 'invalid_cron_secret' })
    return unauthorized(ctx.responseHeaders)
  }

  const run = await startCronJobRun({
    jobName: 'email-thread-lifecycle',
    requestId: ctx.requestId,
  })

  try {
    const { searchParams } = new URL(request.url)
    const staleDays = parseDays(
      searchParams.get('staleDays'),
      DEFAULT_AWAITING_LEAD_REPLY_STALE_DAYS
    )
    const internalReplyOverdueDays = parseDays(
      searchParams.get('internalReplyOverdueDays'),
      DEFAULT_AWAITING_INTERNAL_REPLY_OVERDUE_DAYS
    )
    const now = new Date()
    const cutoff = new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000).toISOString()
    const internalReplyCutoff = new Date(
      now.getTime() - internalReplyOverdueDays * 24 * 60 * 60 * 1000
    ).toISOString()
    const supabase = createServiceClient()

    const { data: resolvedRows, error: updateError } = await supabase
      .from('email_threads')
      .update({ status: 'resolved' })
      .eq('status', 'awaiting_lead_reply')
      .lte('last_message_at', cutoff)
      .select('id, lead_id, property_id, last_message_at')

    if (updateError) {
      ctx.logError(500, updateError, { operation: 'resolve_stale_email_threads', cutoff, staleDays })
      await finishCronJobRun(run, {
        status: 'failed',
        error: updateError.message,
        summary: { operation: 'resolve_stale_email_threads', staleDays },
      })
      return NextResponse.json({ error: updateError.message }, { status: 500, headers: ctx.responseHeaders })
    }

    const rows = (resolvedRows || []) as ThreadRow[]
    const activities = rows
      .filter((row) => row.lead_id)
      .map((row) => ({
        lead_id: row.lead_id as string,
        type: 'email_thread_auto_resolved',
        description: `Email thread auto-resolved after ${staleDays} day(s) without lead reply`,
        metadata: {
          email_thread_id: row.id,
          property_id: row.property_id,
          previous_status: 'awaiting_lead_reply',
          new_status: 'resolved',
          last_message_at: row.last_message_at,
          stale_days_threshold: staleDays,
          resolved_at: now.toISOString(),
          resolution_reason: 'awaiting_lead_reply_timeout',
        },
      }))

    if (activities.length > 0) {
      const { error: activityError } = await supabase.from('lead_activities').insert(activities)
      if (activityError) {
        ctx.logError(500, activityError, {
          operation: 'insert_email_thread_auto_resolved_activities',
          resolvedCount: rows.length,
          activityCount: activities.length,
        })
      }
    }

    const { data: overdueInternalReplyRows, error: overdueInternalReplyError } = await supabase
      .from('email_threads')
      .select('id, lead_id, property_id, last_message_at')
      .eq('status', 'awaiting_internal_reply')
      .lte('last_message_at', internalReplyCutoff)
      .limit(500)

    if (overdueInternalReplyError) {
      ctx.logError(500, overdueInternalReplyError, {
        operation: 'load_overdue_internal_reply_threads',
        internalReplyCutoff,
        internalReplyOverdueDays,
      })
      await finishCronJobRun(run, {
        status: 'failed',
        error: overdueInternalReplyError.message,
        summary: { operation: 'load_overdue_internal_reply_threads', internalReplyOverdueDays },
      })
      return NextResponse.json(
        { error: overdueInternalReplyError.message },
        { status: 500, headers: ctx.responseHeaders }
      )
    }

    const overdueRows = ((overdueInternalReplyRows || []) as ThreadRow[]).filter((row) => row.lead_id)
    const overdueLeadIds = Array.from(new Set(overdueRows.map((row) => row.lead_id as string)))
    let existingEscalationKeys = new Set<string>()

    if (overdueLeadIds.length > 0) {
      const { data: existingEscalations, error: existingEscalationsError } = await supabase
        .from('lead_activities')
        .select('metadata')
        .in('lead_id', overdueLeadIds)
        .eq('type', 'email_thread_internal_reply_overdue')
        .limit(1000)

      if (existingEscalationsError) {
        ctx.logError(500, existingEscalationsError, {
          operation: 'load_existing_internal_reply_escalations',
          overdueLeadIds: overdueLeadIds.length,
        })
        await finishCronJobRun(run, {
          status: 'failed',
          error: existingEscalationsError.message,
          summary: { operation: 'load_existing_internal_reply_escalations' },
        })
        return NextResponse.json(
          { error: existingEscalationsError.message },
          { status: 500, headers: ctx.responseHeaders }
        )
      }

      existingEscalationKeys = new Set(
        ((existingEscalations || []) as LeadActivityRow[])
          .map(extractEscalationKey)
          .filter((value): value is string => Boolean(value))
      )
    }

    const escalationActivities = overdueRows
      .filter((row) => !existingEscalationKeys.has(buildEscalationKey(row.id, row.last_message_at)))
      .map((row) => ({
        lead_id: row.lead_id as string,
        type: 'email_thread_internal_reply_overdue',
        description: `Email thread overdue for internal reply after ${internalReplyOverdueDays} day(s)`,
        metadata: {
          email_thread_id: row.id,
          property_id: row.property_id,
          current_status: 'awaiting_internal_reply',
          last_message_at: row.last_message_at,
          overdue_days_threshold: internalReplyOverdueDays,
          escalated_at: now.toISOString(),
          escalation_reason: 'awaiting_internal_reply_overdue',
        },
      }))

    if (escalationActivities.length > 0) {
      const { error: escalationActivityError } = await supabase
        .from('lead_activities')
        .insert(escalationActivities)

      if (escalationActivityError) {
        ctx.logError(500, escalationActivityError, {
          operation: 'insert_email_thread_internal_reply_overdue_activities',
          overdueCount: overdueRows.length,
          escalationActivityCount: escalationActivities.length,
        })
      }
    }

    const resolved = rows.length
    const activityCount = activities.length
    const overdueInternalReply = overdueRows.length
    const escalationActivityCount = escalationActivities.length
    ctx.logSuccess(200, {
      staleDays,
      cutoff,
      resolved,
      activityCount,
      internalReplyOverdueDays,
      internalReplyCutoff,
      overdueInternalReply,
      escalationActivityCount,
    })
    await finishCronJobRun(run, {
      status: 'success',
      summary: {
        staleDays,
        cutoff,
        resolved,
        activityCount,
        internalReplyOverdueDays,
        internalReplyCutoff,
        overdueInternalReply,
        escalationActivityCount,
      },
    })

    return NextResponse.json(
      {
        success: true,
        staleDays,
        cutoff,
        resolved,
        activityCount,
        internalReplyOverdueDays,
        internalReplyCutoff,
        overdueInternalReply,
        escalationActivityCount,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'run_email_thread_lifecycle_cron' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      summary: { operation: 'run_email_thread_lifecycle_cron' },
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
