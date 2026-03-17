import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  badRequest,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

const UpdateThreadStatusSchema = z.object({
  status: z.enum([
    'awaiting_internal_reply',
    'awaiting_lead_reply',
    'active',
    'resolved',
  ]),
})

type EmailThreadRow = {
  id: string
  property_id: string | null
  lead_id: string | null
  status: string | null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/lumaleasing/email/threads/[threadId]/status'
  )
  ctx.logStart()

  try {
    const supabaseAuth = await createClient()
    const serviceSupabase = createServiceClient()
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const { threadId } = await params
    if (!threadId) {
      ctx.logSuccess(400, { reason: 'missing_thread_id' })
      return badRequest('Thread ID required', ctx.responseHeaders)
    }

    const body = await request.json()
    const parsedBody = UpdateThreadStatusSchema.safeParse(body)
    if (!parsedBody.success) {
      ctx.logSuccess(400, {
        reason: 'invalid_request_body',
        threadId,
      })
      return badRequest('Invalid status update request', ctx.responseHeaders)
    }

    const nextStatus = parsedBody.data.status

    const { data: thread, error: threadError } = await serviceSupabase
      .from('email_threads')
      .select('id, property_id, lead_id, status')
      .eq('id', threadId)
      .maybeSingle()

    if (threadError) {
      ctx.logError(500, threadError, {
        operation: 'load_email_thread',
        threadId,
      })
      return serverError(threadError, ctx.responseHeaders)
    }

    if (!thread) {
      ctx.logSuccess(404, { reason: 'thread_not_found', threadId })
      return notFound('Email thread', ctx.responseHeaders)
    }

    const threadRow = thread as EmailThreadRow
    if (!threadRow.property_id) {
      ctx.logSuccess(400, { reason: 'thread_property_invalid', threadId })
      return badRequest('Email thread property mapping is invalid', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, threadRow.property_id)
    if (!access.authorized) {
      ctx.logSuccess(403, {
        reason: 'forbidden',
        threadId,
        propertyId: threadRow.property_id,
      })
      return forbidden(ctx.responseHeaders)
    }

    const previousStatus = threadRow.status
    if (previousStatus === nextStatus) {
      ctx.logSuccess(200, {
        threadId,
        propertyId: threadRow.property_id,
        status: nextStatus,
        noChange: true,
      })

      return NextResponse.json(
        {
          success: true,
          threadId,
          status: nextStatus,
          previousStatus,
          noChange: true,
        },
        { headers: ctx.responseHeaders }
      )
    }

    const { error: updateError } = await serviceSupabase
      .from('email_threads')
      .update({ status: nextStatus })
      .eq('id', threadId)

    if (updateError) {
      ctx.logError(500, updateError, {
        operation: 'update_email_thread_status',
        threadId,
      })
      return serverError(updateError, ctx.responseHeaders)
    }

    if (threadRow.lead_id) {
      const { error: activityError } = await serviceSupabase
        .from('lead_activities')
        .insert({
          lead_id: threadRow.lead_id,
          type: 'email_thread_status_updated',
          description: `Email thread status changed to ${nextStatus}`,
          metadata: {
            email_thread_id: threadId,
            previous_status: previousStatus,
            new_status: nextStatus,
          },
        })

      if (activityError) {
        console.error(
          '[LumaLeasing] Failed to create email thread status activity:',
          activityError
        )
      }
    }

    ctx.logSuccess(200, {
      threadId,
      propertyId: threadRow.property_id,
      previousStatus,
      status: nextStatus,
      noChange: false,
    })

    return NextResponse.json(
      {
        success: true,
        threadId,
        previousStatus,
        status: nextStatus,
        noChange: false,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, {
      operation: 'update_email_thread_status',
    })
    return serverError(error, ctx.responseHeaders)
  }
}
