/**
 * Send Email via Gmail API
 * Sends emails to leads via Gmail
 */

import { NextRequest, NextResponse } from 'next/server'
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
import { getGmailConfig, sendEmail } from '@/utils/services/gmail-service'
import { z } from 'zod'

const SendEmailSchema = z.object({
  propertyId: z.string().min(1, 'Property ID required'),
  to: z.string().email('Valid email required'),
  cc: z.string().email().optional(),
  bcc: z.string().email().optional(),
  subject: z.string().min(1, 'Subject required'),
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),
  replyToMessageId: z.string().optional(),
  threadId: z.string().optional(),
  leadId: z.string().optional(),
  markThreadResolved: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (!value.bodyText?.trim() && !value.bodyHtml?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either bodyText or bodyHtml is required',
      path: ['bodyText'],
    })
  }
})

type SendEmailRequest = z.infer<typeof SendEmailSchema>
type LeadRecord = {
  id: string
  property_id: string | null
}

type EmailThreadLookup = {
  id: string
  gmail_thread_id: string
}

type ExistingEmailMessage = {
  gmail_message_id: string
  email_thread_id: string | null
  subject: string | null
  body_text: string | null
  body_html: string | null
  to_emails: string[] | null
  internal_date: string | null
}

function buildSnippet(bodyText?: string, bodyHtml?: string): string | null {
  const htmlFallback = bodyHtml
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const snippet = (bodyText?.trim() || htmlFallback || '').slice(0, 200)
  return snippet || null
}

function normalizeOptionalBody(value?: string): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

async function findRecentDuplicateEmail(
  supabase: ReturnType<typeof createServiceClient>,
  params: {
    emailConfigurationId: string
    propertyId: string
    leadId?: string
    threadId?: string
    to: string
    subject: string
    bodyText?: string
    bodyHtml?: string
  }
): Promise<{ messageId: string; threadId: string } | null> {
  const { emailConfigurationId, propertyId, leadId, threadId, to, subject, bodyText, bodyHtml } = params
  const normalizedBodyText = normalizeOptionalBody(bodyText)
  const normalizedBodyHtml = normalizeOptionalBody(bodyHtml)

  if (!threadId && !leadId) {
    return null
  }

  let threadRows: EmailThreadLookup[] = []

  if (threadId) {
    const { data, error } = await supabase
      .from('email_threads')
      .select('id, gmail_thread_id')
      .eq('email_configuration_id', emailConfigurationId)
      .eq('gmail_thread_id', threadId)
      .maybeSingle()

    if (error) {
      console.error('[Gmail] Failed to check duplicate thread by Gmail thread id:', error)
      return null
    }

    if (data) {
      threadRows = [data as EmailThreadLookup]
    }
  } else if (leadId) {
    const { data, error } = await supabase
      .from('email_threads')
      .select('id, gmail_thread_id')
      .eq('email_configuration_id', emailConfigurationId)
      .eq('property_id', propertyId)
      .eq('lead_id', leadId)
      .order('last_message_at', { ascending: false })
      .limit(5)

    if (error) {
      console.error('[Gmail] Failed to check duplicate threads by lead:', error)
      return null
    }

    threadRows = (data || []) as EmailThreadLookup[]
  }

  if (threadRows.length === 0) {
    return null
  }

  const threadIds = threadRows.map((row) => row.id)
  const threadById = new Map(threadRows.map((row) => [row.id, row.gmail_thread_id]))
  const recentCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const { data: messages, error: messagesError } = await supabase
    .from('email_messages')
    .select('gmail_message_id, email_thread_id, subject, body_text, body_html, to_emails, internal_date')
    .in('email_thread_id', threadIds)
    .eq('direction', 'outbound')
    .eq('subject', subject)
    .gte('internal_date', recentCutoff)
    .order('internal_date', { ascending: false })
    .limit(10)

  if (messagesError) {
    console.error('[Gmail] Failed to check duplicate outbound messages:', messagesError)
    return null
  }

  const duplicate = ((messages || []) as ExistingEmailMessage[]).find((message) => {
    const recipients = Array.isArray(message.to_emails) ? message.to_emails : []
    if (!recipients.includes(to)) {
      return false
    }

    return (
      normalizeOptionalBody(message.body_text || undefined) === normalizedBodyText &&
      normalizeOptionalBody(message.body_html || undefined) === normalizedBodyHtml
    )
  })

  if (!duplicate?.gmail_message_id || !duplicate.email_thread_id) {
    return null
  }

  const gmailThreadId = threadById.get(duplicate.email_thread_id)
  if (!gmailThreadId) {
    return null
  }

  return {
    messageId: duplicate.gmail_message_id,
    threadId: gmailThreadId,
  }
}

async function upsertEmailThread(
  supabase: ReturnType<typeof createServiceClient>,
  params: {
    emailConfigurationId: string
    propertyId: string
    leadId?: string
    gmailThreadId: string
    subject: string
    threadStatus: 'awaiting_lead_reply' | 'resolved'
  }
): Promise<string | null> {
  const now = new Date().toISOString()
  const { emailConfigurationId, propertyId, leadId, gmailThreadId, subject, threadStatus } = params

  const { data: existingThread, error: existingThreadError } = await supabase
    .from('email_threads')
    .select('id, message_count, direction, lead_id')
    .eq('email_configuration_id', emailConfigurationId)
    .eq('gmail_thread_id', gmailThreadId)
    .maybeSingle()

  if (existingThreadError) {
    console.error('[Gmail] Failed to read email thread:', existingThreadError)
    return null
  }

  if (existingThread) {
    const { error: updateError } = await supabase
      .from('email_threads')
      .update({
        last_message_at: now,
        message_count: (existingThread.message_count || 0) + 1,
        subject,
        lead_id: existingThread.lead_id || leadId || null,
        status: threadStatus,
        direction:
          existingThread.direction === 'inbound'
            ? 'mixed'
            : existingThread.direction || 'outbound',
      })
      .eq('id', existingThread.id)

    if (updateError) {
      console.error('[Gmail] Failed to update email thread:', updateError)
      return null
    }

    return existingThread.id
  }

  const { data: newThread, error: insertError } = await supabase
    .from('email_threads')
    .insert({
      email_configuration_id: emailConfigurationId,
      property_id: propertyId,
      lead_id: leadId || null,
      gmail_thread_id: gmailThreadId,
      subject,
      last_message_at: now,
      message_count: 1,
      status: threadStatus,
      direction: 'outbound',
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[Gmail] Failed to create email thread:', insertError)
    return null
  }

  return newThread.id
}

async function updateThreadStatusByGmailThreadId(
  supabase: ReturnType<typeof createServiceClient>,
  params: {
    emailConfigurationId: string
    gmailThreadId: string
    threadStatus: 'awaiting_lead_reply' | 'resolved'
  }
) {
  const { emailConfigurationId, gmailThreadId, threadStatus } = params
  const { error } = await supabase
    .from('email_threads')
    .update({ status: threadStatus })
    .eq('email_configuration_id', emailConfigurationId)
    .eq('gmail_thread_id', gmailThreadId)

  if (error) {
    console.error('[Gmail] Failed to update thread status for duplicate send:', error)
  }
}

async function insertEmailMessage(
  supabase: ReturnType<typeof createServiceClient>,
  params: {
    emailThreadId: string | null
    gmailMessageId: string
    fromEmail: string
    to: string
    cc?: string
    bcc?: string
    subject: string
    bodyText?: string
    bodyHtml?: string
  }
) {
  const now = new Date().toISOString()
  const {
    emailThreadId,
    gmailMessageId,
    fromEmail,
    to,
    cc,
    bcc,
    subject,
    bodyText,
    bodyHtml,
  } = params

  const { error } = await supabase.from('email_messages').insert({
    email_thread_id: emailThreadId,
    gmail_message_id: gmailMessageId,
    direction: 'outbound',
    from_email: fromEmail,
    to_emails: [to],
    cc_emails: cc ? [cc] : null,
    bcc_emails: bcc ? [bcc] : null,
    subject,
    body_text: bodyText || null,
    body_html: bodyHtml || null,
    snippet: buildSnippet(bodyText, bodyHtml),
    has_attachments: false,
    attachments: [],
    labels: ['SENT'],
    internal_date: now,
  })

  if (error) {
    console.error('[Gmail] Failed to store message:', error)
  }
}

async function insertLeadActivity(
  supabase: ReturnType<typeof createServiceClient>,
  params: {
    leadId: string
    recipient: string
    subject: string
    gmailMessageId: string
  }
) {
  const { error } = await supabase.from('lead_activities').insert({
    lead_id: params.leadId,
    type: 'email_sent',
    description: `Email sent to ${params.recipient}${params.subject ? `: ${params.subject}` : ''}`,
    metadata: {
      gmail_message_id: params.gmailMessageId,
      recipient: params.recipient,
      subject: params.subject,
    },
  })

  if (error) {
    console.error('[Gmail] Failed to create lead activity:', error)
  }
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/email/send')
  ctx.logStart()

  try {
    // Verify user authentication
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    // Parse and validate request body
    const body = await request.json()
    let emailRequest: SendEmailRequest

    try {
      emailRequest = SendEmailSchema.parse(body)
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        ctx.logSuccess(400, { reason: 'invalid_request_body' })
        return NextResponse.json(
          { error: 'Invalid request body', details: validationError.issues },
          { status: 400, headers: ctx.responseHeaders }
        )
      }
      throw validationError
    }

    const {
      propertyId,
      to,
      cc,
      bcc,
      subject,
      bodyText,
      bodyHtml,
      replyToMessageId,
      threadId,
      leadId,
      markThreadResolved,
    } = emailRequest
    const threadStatus = markThreadResolved ? 'resolved' : 'awaiting_lead_reply'

    // Verify property access
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const serviceSupabase = createServiceClient()

    let lead: LeadRecord | null = null
    if (leadId) {
      const { data: leadRecord, error: leadError } = await serviceSupabase
        .from('leads')
        .select('id, property_id')
        .eq('id', leadId)
        .single()

      if (leadError || !leadRecord) {
        ctx.logSuccess(404, { reason: 'lead_not_found', leadId, propertyId })
        return notFound('Lead', ctx.responseHeaders)
      }

      if (!leadRecord.property_id) {
        ctx.logSuccess(404, { reason: 'lead_property_not_found', leadId })
        return notFound('Property', ctx.responseHeaders)
      }

      if (leadRecord.property_id !== propertyId) {
        ctx.logSuccess(400, {
          reason: 'lead_property_mismatch',
          leadId,
          propertyId,
          leadPropertyId: leadRecord.property_id,
        })
        return badRequest('Lead does not belong to this property', ctx.responseHeaders)
      }

      lead = leadRecord
    }

    // Get email configuration
    const emailConfig = await getGmailConfig(propertyId)

    if (!emailConfig) {
      ctx.logSuccess(400, { reason: 'gmail_not_configured', propertyId })
      return badRequest('Gmail not configured for this property', ctx.responseHeaders)
    }

    if (emailConfig.token_status === 'revoked') {
      ctx.logSuccess(400, { reason: 'gmail_reconnect_required', propertyId })
      return badRequest('Gmail authorization revoked. Please reconnect.', ctx.responseHeaders)
    }

    const duplicateSend = await findRecentDuplicateEmail(serviceSupabase, {
      emailConfigurationId: emailConfig.id,
      propertyId,
      leadId: lead?.id,
      threadId,
      to,
      subject,
      bodyText,
      bodyHtml,
    })

    if (duplicateSend) {
      if (markThreadResolved) {
        await updateThreadStatusByGmailThreadId(serviceSupabase, {
          emailConfigurationId: emailConfig.id,
          gmailThreadId: duplicateSend.threadId,
          threadStatus,
        })
      }

      ctx.logSuccess(200, {
        propertyId,
        leadId: lead?.id || null,
        messageId: duplicateSend.messageId,
        gmailThreadId: duplicateSend.threadId,
        duplicate: true,
      })

      return NextResponse.json(
        {
          success: true,
          duplicate: true,
          messageId: duplicateSend.messageId,
          threadId: duplicateSend.threadId,
        },
        { headers: ctx.responseHeaders }
      )
    }

    let sendResult: { messageId: string; threadId: string }
    try {
      sendResult = await sendEmail(emailConfig, {
        to: [to],
        cc: cc ? [cc] : undefined,
        bcc: bcc ? [bcc] : undefined,
        subject,
        bodyText,
        bodyHtml,
        replyToMessageId,
        threadId,
      })
    } catch (sendError) {
      if (
        sendError instanceof Error &&
        sendError.message.includes('Please reconnect')
      ) {
        ctx.logSuccess(400, { reason: 'gmail_reconnect_required', propertyId })
        return badRequest(sendError.message, ctx.responseHeaders)
      }

      ctx.logError(500, sendError, {
        operation: 'gmail_send_email',
        propertyId,
        leadId: leadId || null,
      })
      return serverError(sendError, ctx.responseHeaders)
    }

    const messageId = sendResult.messageId
    const gmailThreadId = sendResult.threadId || messageId

    const emailThreadId = await upsertEmailThread(serviceSupabase, {
      emailConfigurationId: emailConfig.id,
      propertyId,
      leadId: lead?.id,
      gmailThreadId,
      subject,
      threadStatus,
    })

    await insertEmailMessage(serviceSupabase, {
      emailThreadId,
      gmailMessageId: messageId,
      fromEmail: emailConfig.google_email,
      to,
      cc,
      bcc,
      subject,
      bodyText,
      bodyHtml,
    })

    if (lead?.id) {
      await insertLeadActivity(serviceSupabase, {
        leadId: lead.id,
        recipient: to,
        subject,
        gmailMessageId: messageId,
      })
    }

    ctx.logSuccess(200, {
      propertyId,
      leadId: lead?.id || null,
      messageId,
      gmailThreadId,
      storedThread: !!emailThreadId,
    })

    return NextResponse.json(
      {
        success: true,
        messageId,
        threadId: gmailThreadId,
      },
      { headers: ctx.responseHeaders }
    )

  } catch (error) {
    ctx.logError(500, error, { operation: 'gmail_send_email' })
    return serverError(error, ctx.responseHeaders)
  }
}
