/**
 * TourSpark Messaging Service
 * Handles SMS (Telnyx) and Email (Resend) sending
 */

import { Resend } from 'resend'

// Types
export type MessageChannel = 'sms' | 'email'

export interface SendMessageOptions {
  to: string
  channel: MessageChannel
  body: string
  subject?: string // Required for email
  from?: string
  propertyName?: string
}

export interface MessageResult {
  success: boolean
  messageId?: string
  error?: string
  channel: MessageChannel
}

export interface TemplateVariables {
  first_name?: string
  last_name?: string
  property_name?: string
  tour_link?: string
  tour_time?: string
  tour_date?: string
  [key: string]: string | undefined
}

interface TelnyxApiError {
  detail?: string
  title?: string
}

interface TelnyxResponseBody {
  data?: {
    id?: string
  }
  errors?: TelnyxApiError[]
}

interface ResendSendResultShape {
  data?: {
    id?: string
  } | null
  id?: string
  error?: string | { message?: string } | null
}

// Initialize Resend client (lazy)
let resendClient: Resend | null = null

function getResendClient(): Resend | null {
  if (resendClient) return resendClient

  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    console.warn('[Messaging] Resend API key not configured')
    return null
  }

  resendClient = new Resend(apiKey)
  return resendClient
}

/**
 * Replace template variables in message body
 * Variables are in format {{variable_name}}
 */
export function replaceTemplateVariables(
  template: string,
  variables: TemplateVariables
): string {
  // Support both legacy {var} and canonical {{var}} formats.
  return template
    .replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] || match)
    .replace(/\{(\w+)\}/g, (match, key) => variables[key] || match)
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function getResendErrorMessage(result: ResendSendResultShape): string | null {
  const maybeError = result.error
  if (!maybeError) {
    return null
  }

  if (typeof maybeError === 'string') {
    return maybeError
  }

  if (typeof maybeError === 'object' && typeof maybeError.message === 'string') {
    return maybeError.message
  }

  return JSON.stringify(maybeError)
}

function getResendMessageId(result: ResendSendResultShape): string | undefined {
  return result.data?.id ?? result.id
}

/**
 * Send SMS via Telnyx REST API
 * https://developers.telnyx.com/docs/messaging/messages/send-receive-mms
 */
export async function sendSMS(
  to: string,
  body: string,
  from?: string
): Promise<MessageResult> {
  const apiKey = process.env.TELNYX_API_KEY
  const fromNumber = from || process.env.TELNYX_PHONE_NUMBER

  if (!apiKey || !fromNumber) {
    console.warn('[SMS] Telnyx not configured — set TELNYX_API_KEY and TELNYX_PHONE_NUMBER')
    return {
      success: false,
      error: 'SMS provider not configured (missing TELNYX_API_KEY or TELNYX_PHONE_NUMBER)',
      channel: 'sms',
    }
  }

  try {
    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromNumber,
        to,
        text: body,
      }),
    })

    const data = await parseJsonSafe<TelnyxResponseBody>(response)

    if (!response.ok) {
      const errorDetail = data?.errors?.[0]?.detail
        || data?.errors?.[0]?.title
        || `Telnyx API error (${response.status})`
      console.error('[SMS] Telnyx error:', errorDetail, data)
      return {
        success: false,
        error: errorDetail,
        channel: 'sms',
      }
    }

    const messageId = data?.data?.id
    console.log(`[SMS] Sent to ${to}: ${messageId}`)

    return {
      success: true,
      messageId,
      channel: 'sms',
    }
  } catch (error) {
    console.error('[SMS] Error sending:', error)

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      channel: 'sms',
    }
  }
}

// Email attachment type
export interface EmailAttachment {
  filename: string
  content: string // base64 encoded
  contentType?: string
}

/**
 * Send Email via Resend
 * Supports plain text, HTML, and attachments (including .ics calendar invites)
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  from?: string,
  html?: string,
  attachments?: EmailAttachment[]
): Promise<MessageResult> {
  const client = getResendClient()
  const fromEmail = from || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

  // Validate inputs
  if (!to || !subject || !body) {
    console.error('[Email] Missing required fields:', { to: !!to, subject: !!subject, body: !!body })
    return {
      success: false,
      error: 'Missing required fields: to, subject, or body',
      channel: 'email',
    }
  }

  if (!client) {
    console.warn('[Email] Resend not configured — set RESEND_API_KEY')
    return {
      success: false,
      error: 'Email provider not configured (missing RESEND_API_KEY)',
      channel: 'email',
    }
  }

  try {
    // Build Resend attachments format
    const resendAttachments = attachments?.map(att => ({
      filename: att.filename,
      content: Buffer.from(att.content, 'base64'),
      content_type: att.contentType
    }))

    const result = await client.emails.send({
      from: fromEmail,
      to,
      subject,
      text: body,
      ...(html && { html }),
      ...(resendAttachments?.length && { attachments: resendAttachments }),
    })

    const resendResult = result as ResendSendResultShape
    const resendError = getResendErrorMessage(resendResult)
    if (resendError) {
      console.error('[Email] Resend API returned error:', resendError)
      return {
        success: false,
        error: resendError,
        channel: 'email',
      }
    }

    const messageId = getResendMessageId(resendResult)
    console.log(`[Email] Sent to ${to}: ${messageId}`)

    return {
      success: true,
      messageId,
      channel: 'email',
    }
  } catch (error) {
    console.error('[Email] Error sending:', error)

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      channel: 'email',
    }
  }
}

/**
 * Send a message via the appropriate channel
 */
export async function sendMessage(options: SendMessageOptions): Promise<MessageResult> {
  const { to, channel, body, subject } = options

  if (channel === 'sms') {
    return sendSMS(to, body, options.from)
  } else if (channel === 'email') {
    if (!subject) {
      return {
        success: false,
        error: 'Subject is required for email',
        channel: 'email',
      }
    }
    return sendEmail(to, subject, body, options.from)
  }

  return {
    success: false,
    error: `Unknown channel: ${channel}`,
    channel,
  }
}

/**
 * Check if messaging is configured
 */
export function isMessagingConfigured(): { sms: boolean; email: boolean } {
  return {
    sms: !!(process.env.TELNYX_API_KEY && process.env.TELNYX_PHONE_NUMBER),
    email: !!process.env.RESEND_API_KEY,
  }
}
