/**
 * Gmail API Service
 * Handles OAuth token management, email sending via Gmail API,
 * inbox sync, and thread management for LumaLeasing
 */

import { createServiceClient } from '@/utils/supabase/admin'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const MICROSOFT_GRAPH_API = 'https://graph.microsoft.com/v1.0'

// Types
export interface GmailConfig {
  id: string
  property_id: string
  profile_id: string
  provider?: 'google' | 'microsoft'
  google_email: string
  account_email?: string
  access_token: string
  refresh_token: string
  token_expires_at: string
  sync_enabled: boolean
  auto_reply_enabled: boolean
  signature_template: string | null
  token_status: string
  last_sync_at: string | null
  history_id: string | null
  watch_expiration: string | null
  provider_metadata?: Record<string, unknown> | null
}

export interface EmailMessage {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  bodyText?: string
  bodyHtml?: string
  replyToMessageId?: string  // For threading replies
  threadId?: string          // Gmail thread ID for replies
}

export interface ParsedEmail {
  messageId: string
  threadId: string
  from: { email: string; name: string }
  to: { email: string; name: string }[]
  cc: { email: string; name: string }[]
  subject: string
  bodyText: string
  bodyHtml: string
  snippet: string
  internalDate: string
  labels: string[]
  hasAttachments: boolean
  attachments: { name: string; mimeType: string; size: number; attachmentId: string }[]
}

interface GmailHeader {
  name: string
  value: string
}

interface GmailMessagePart {
  mimeType?: string
  body?: {
    data?: string
    size?: number
    attachmentId?: string
  }
  parts?: GmailMessagePart[]
  filename?: string
}

interface GmailApiMessage {
  id: string
  threadId: string
  payload?: {
    headers?: GmailHeader[]
    parts?: GmailMessagePart[]
    mimeType?: string
    body?: GmailMessagePart['body']
  }
  snippet?: string
  internalDate?: string
  labelIds?: string[]
}

interface GmailListItem {
  id: string
  threadId: string
  snippet: string
}

export interface SyncResult {
  newMessages: number
  updatedThreads: number
}

interface SyncInboxOptions {
  historyIdHint?: string
}

export interface ListMessagesOptions {
  maxResults?: number
  from?: string
  to?: string
  after?: string // ISO date
  before?: string // ISO date
  unreadOnly?: boolean
  includeSpam?: boolean
}

// ============================================================================
// Token Management
// ============================================================================

/**
 * Refresh access token if expired or expiring soon
 */
export async function refreshAccessTokenIfNeeded(
  config: GmailConfig
): Promise<{ accessToken: string; expiresAt: string }> {
  const expiresAt = new Date(config.token_expires_at)
  const now = new Date()

  // If token expires in less than 5 minutes, refresh it
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    console.log('[Gmail] Token expiring soon, refreshing...')
    return await refreshAccessToken(config)
  }

  return {
    accessToken: config.access_token,
    expiresAt: config.token_expires_at,
  }
}

/**
 * Refresh the access token using refresh token
 */
async function refreshAccessToken(
  config: GmailConfig
): Promise<{ accessToken: string; expiresAt: string }> {
  const supabase = createServiceClient()

  try {
    const isMicrosoft = config.provider === 'microsoft'
    const response = await fetch(isMicrosoft ? getMicrosoftEmailTokenUrl() : GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: isMicrosoft
          ? process.env.MICROSOFT_CLIENT_ID || ''
          : process.env.GOOGLE_CLIENT_ID || '',
        client_secret: isMicrosoft
          ? process.env.MICROSOFT_CLIENT_SECRET || ''
          : process.env.GOOGLE_CLIENT_SECRET || '',
        refresh_token: config.refresh_token,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Gmail] Token refresh failed:', errorText)

      // Check if refresh token is revoked
      if (errorText.includes('invalid_grant')) {
        await supabase
          .from('email_configurations')
          .update({
            token_status: 'revoked',
            updated_at: new Date().toISOString(),
          })
          .eq('id', config.id)

        throw new Error('Gmail authorization revoked. Please reconnect.')
      }

      throw new Error('Failed to refresh token')
    }

    const tokens = await response.json()
    const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Update database with new token
    await supabase
      .from('email_configurations')
      .update({
        access_token: tokens.access_token,
        token_expires_at: newExpiresAt,
        token_status: 'healthy',
        updated_at: new Date().toISOString(),
      })
      .eq('id', config.id)

    // Log refresh for audit
    await supabase
      .from('email_token_refreshes')
      .insert({
        email_configuration_id: config.id,
        refresh_status: 'success',
        old_expires_at: config.token_expires_at,
        new_expires_at: newExpiresAt,
      })

    return {
      accessToken: tokens.access_token,
      expiresAt: newExpiresAt,
    }
  } catch (error) {
    // Log failed refresh
    await supabase
      .from('email_token_refreshes')
      .insert({
        email_configuration_id: config.id,
        refresh_status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        old_expires_at: config.token_expires_at,
      })

    throw error
  }
}

function getMicrosoftEmailTokenUrl(): string {
  const tenantId = process.env.MICROSOFT_TENANT_ID?.trim() || 'common'
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get email configuration for a property
 */
export async function getGmailConfig(propertyId: string): Promise<GmailConfig | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('email_configurations')
    .select('*')
    .eq('property_id', propertyId)
    .eq('sync_enabled', true)
    .single()

  if (error || !data) {
    return null
  }

  if (!data.property_id || !data.profile_id || !data.access_token || !data.refresh_token || !data.token_expires_at) {
    return null
  }

  const accountEmail = data.account_email || data.google_email
  if (!accountEmail) {
    return null
  }

  return {
    id: data.id,
    property_id: data.property_id,
    profile_id: data.profile_id,
    provider: data.provider === 'microsoft' ? 'microsoft' : 'google',
    google_email: data.google_email || accountEmail,
    account_email: accountEmail,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_expires_at: data.token_expires_at,
    sync_enabled: data.sync_enabled ?? true,
    auto_reply_enabled: data.auto_reply_enabled ?? false,
    signature_template: data.signature_template,
    token_status: data.token_status || 'healthy',
    last_sync_at: data.last_sync_at,
    history_id: data.history_id,
    watch_expiration: data.watch_expiration,
    provider_metadata:
      data.provider_metadata &&
      typeof data.provider_metadata === 'object' &&
      !Array.isArray(data.provider_metadata)
        ? data.provider_metadata as Record<string, unknown>
        : {},
  }
}

// ============================================================================
// Email Sending
// ============================================================================

/**
 * Send email via Gmail API
 * Handles RFC 2822 MIME formatting with optional HTML multipart support
 */
export async function sendEmail(
  config: GmailConfig,
  message: EmailMessage
): Promise<{ messageId: string; threadId: string }> {
  // Ensure token is fresh
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  try {
    if (config.provider === 'microsoft') {
      const response = await fetch(`${MICROSOFT_GRAPH_API}/me/sendMail`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: {
              contentType: message.bodyHtml ? 'HTML' : 'Text',
              content: message.bodyHtml || message.bodyText || '',
            },
            toRecipients: message.to.map((address) => ({
              emailAddress: { address },
            })),
            ccRecipients: (message.cc || []).map((address) => ({
              emailAddress: { address },
            })),
            bccRecipients: (message.bcc || []).map((address) => ({
              emailAddress: { address },
            })),
          },
          saveToSentItems: true,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[MicrosoftMail] Send email failed:', errorText)

        if (response.status === 401) {
          const { accessToken: newToken } = await refreshAccessToken(config)
          return sendEmail({ ...config, access_token: newToken }, message)
        }

        throw new Error(`Microsoft Mail API error: ${response.status}`)
      }

      const generatedId = `microsoft-sent-${Date.now()}`
      return {
        messageId: generatedId,
        threadId: message.threadId || generatedId,
      }
    }

    // Build MIME message
    const mimeMessage = buildMimeMessage(message, config.google_email, config.signature_template)

    // Make Gmail API call
    const response = await fetch(`${GMAIL_API}/messages/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        raw: encodeBase64Url(mimeMessage),
        ...(message.threadId && { threadId: message.threadId }),
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Gmail] Send email failed:', errorText)

      // Retry once if 401
      if (response.status === 401) {
        const { accessToken: newToken } = await refreshAccessToken(config)
        return sendEmail({ ...config, access_token: newToken }, message)
      }

      throw new Error(`Gmail API error: ${response.status}`)
    }

    const data = await response.json()
    console.log(`[Gmail] Email sent: ${data.id}`)

    return {
      messageId: data.id,
      threadId: data.threadId || message.threadId || '',
    }
  } catch (error) {
    console.error('[Gmail] Error sending email:', error)
    throw error
  }
}

// ============================================================================
// Thread Management
// ============================================================================

/**
 * Get a Gmail thread with all messages
 */
export async function getThread(
  config: GmailConfig,
  threadId: string
): Promise<ParsedEmail[]> {
  // Ensure token is fresh
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  try {
    const response = await fetch(`${GMAIL_API}/threads/${threadId}?format=full`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Gmail] Get thread failed:', errorText)

      // Retry once if 401
      if (response.status === 401) {
        const { accessToken: newToken } = await refreshAccessToken(config)
        return getThread({ ...config, access_token: newToken }, threadId)
      }

      throw new Error(`Gmail API error: ${response.status}`)
    }

    const data = await response.json()
    const messages = (data.messages || []) as GmailApiMessage[]

    return messages.map((msg) => parseGmailMessage(msg))
  } catch (error) {
    console.error('[Gmail] Error fetching thread:', error)
    throw error
  }
}

// ============================================================================
// Message Listing & Retrieval
// ============================================================================

/**
 * List recent inbox messages with optional filters
 */
export async function listRecentMessages(
  config: GmailConfig,
  options: ListMessagesOptions = {}
): Promise<Array<{ id: string; threadId: string; snippet: string }>> {
  // Ensure token is fresh
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  try {
    // Build query string
    const queryParts: string[] = []

    if (options.from) {
      queryParts.push(`from:${options.from}`)
    }
    if (options.to) {
      queryParts.push(`to:${options.to}`)
    }
    if (options.after) {
      const afterDate = new Date(options.after)
      queryParts.push(`after:${Math.floor(afterDate.getTime() / 1000)}`)
    }
    if (options.before) {
      const beforeDate = new Date(options.before)
      queryParts.push(`before:${Math.floor(beforeDate.getTime() / 1000)}`)
    }
    if (options.unreadOnly) {
      queryParts.push('is:unread')
    }
    if (!options.includeSpam) {
      queryParts.push('-in:spam')
      queryParts.push('-in:trash')
    }

    const q = queryParts.join(' ')
    const maxResults = options.maxResults || 20

    const response = await fetch(
      `${GMAIL_API}/messages?maxResults=${maxResults}${q ? '&q=' + encodeURIComponent(q) : ''}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Gmail] List messages failed:', errorText)

      // Retry once if 401
      if (response.status === 401) {
        const { accessToken: newToken } = await refreshAccessToken(config)
        return listRecentMessages({ ...config, access_token: newToken }, options)
      }

      throw new Error(`Gmail API error: ${response.status}`)
    }

    const data = await response.json()
    const messages = (data.messages || []) as GmailListItem[]

    return messages.map((msg) => ({
      id: msg.id,
      threadId: msg.threadId,
      snippet: msg.snippet,
    }))
  } catch (error) {
    console.error('[Gmail] Error listing messages:', error)
    throw error
  }
}

/**
 * Get full message details
 */
export async function getMessage(
  config: GmailConfig,
  messageId: string
): Promise<ParsedEmail> {
  // Ensure token is fresh
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  try {
    const response = await fetch(`${GMAIL_API}/messages/${messageId}?format=full`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Gmail] Get message failed:', errorText)

      // Retry once if 401
      if (response.status === 401) {
        const { accessToken: newToken } = await refreshAccessToken(config)
        return getMessage({ ...config, access_token: newToken }, messageId)
      }

      throw new Error(`Gmail API error: ${response.status}`)
    }

    const data = await response.json()
    return parseGmailMessage(data)
  } catch (error) {
    console.error('[Gmail] Error getting message:', error)
    throw error
  }
}

// ============================================================================
// Inbox Sync
// ============================================================================

interface PersistInboundMessageParams {
  supabase: ReturnType<typeof createServiceClient>
  config: GmailConfig
  parsed: ParsedEmail
  leadId: string | null
}

type UpsertInboundEmailThreadResult = {
  emailThreadId: string | null
  effectiveLeadId: string | null
  reopenedFromResolved: boolean
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function findExistingMessageId(
  supabase: ReturnType<typeof createServiceClient>,
  gmailMessageId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('email_messages')
    .select('id')
    .eq('gmail_message_id', gmailMessageId)
    .maybeSingle()

  if (error) {
    console.error('[Gmail] Failed checking existing email message:', error)
    return null
  }

  return data?.id || null
}

async function upsertInboundEmailThread(
  supabase: ReturnType<typeof createServiceClient>,
  config: GmailConfig,
  parsed: ParsedEmail,
  leadId: string | null
): Promise<UpsertInboundEmailThreadResult> {
  const now = new Date().toISOString()
  const gmailThreadId = parsed.threadId || parsed.messageId

  const { data: existingThread, error: existingThreadError } = await supabase
    .from('email_threads')
    .select('id, message_count, direction, lead_id, subject, status')
    .eq('email_configuration_id', config.id)
    .eq('gmail_thread_id', gmailThreadId)
    .maybeSingle()

  if (existingThreadError) {
    console.error('[Gmail] Failed to load email thread:', existingThreadError)
    return {
      emailThreadId: null,
      effectiveLeadId: leadId,
      reopenedFromResolved: false,
    }
  }

  if (existingThread) {
    const effectiveLeadId = existingThread.lead_id || leadId
    const reopenedFromResolved = existingThread.status === 'resolved'
    const { error: updateError } = await supabase
      .from('email_threads')
      .update({
        last_message_at: now,
        message_count: (existingThread.message_count || 0) + 1,
        subject: parsed.subject || existingThread.subject || null,
        lead_id: effectiveLeadId,
        status: 'awaiting_internal_reply',
        direction:
          existingThread.direction === 'outbound'
            ? 'mixed'
            : existingThread.direction || 'inbound',
      })
      .eq('id', existingThread.id)

    if (updateError) {
      console.error('[Gmail] Failed to update email thread:', updateError)
      return {
        emailThreadId: null,
        effectiveLeadId,
        reopenedFromResolved: false,
      }
    }

    return {
      emailThreadId: existingThread.id,
      effectiveLeadId,
      reopenedFromResolved,
    }
  }

  const { data: newThread, error: insertError } = await supabase
    .from('email_threads')
    .insert({
      email_configuration_id: config.id,
      property_id: config.property_id,
      lead_id: leadId,
      gmail_thread_id: gmailThreadId,
      provider_thread_id: gmailThreadId,
      subject: parsed.subject || null,
      last_message_at: now,
      message_count: 1,
      status: 'awaiting_internal_reply',
      direction: 'inbound',
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[Gmail] Failed to create email thread:', insertError)
    return {
      emailThreadId: null,
      effectiveLeadId: leadId,
      reopenedFromResolved: false,
    }
  }

  return {
    emailThreadId: newThread.id,
    effectiveLeadId: leadId,
    reopenedFromResolved: false,
  }
}

async function persistInboundMessage({
  supabase,
  config,
  parsed,
  leadId,
}: PersistInboundMessageParams): Promise<boolean> {
  const existingMessageId = await findExistingMessageId(supabase, parsed.messageId)
  if (existingMessageId) {
    return false
  }

  const threadResult = await upsertInboundEmailThread(supabase, config, parsed, leadId)
  const { emailThreadId, effectiveLeadId, reopenedFromResolved } = threadResult
  const toEmails = parsed.to.map((recipient) => recipient.email).filter(Boolean)
  const ccEmails = parsed.cc.map((recipient) => recipient.email).filter(Boolean)

  const { error } = await supabase
    .from('email_messages')
    .insert({
      email_thread_id: emailThreadId,
      gmail_message_id: parsed.messageId,
      provider_message_id: parsed.messageId,
      direction: 'inbound',
      from_email: normalizeEmail(parsed.from.email),
      from_name: parsed.from.name || null,
      to_emails: toEmails.length > 0 ? toEmails : [config.google_email],
      cc_emails: ccEmails.length > 0 ? ccEmails : null,
      subject: parsed.subject || null,
      body_text: parsed.bodyText || null,
      body_html: parsed.bodyHtml || null,
      snippet: parsed.snippet || null,
      has_attachments: parsed.hasAttachments,
      attachments: parsed.attachments,
      labels: parsed.labels,
      internal_date: parsed.internalDate || null,
      ai_generated: config.auto_reply_enabled && !!leadId ? true : false,
      ai_draft_approved: null,
    })

  if (error) {
    console.error('[Gmail] Failed to persist inbound email message:', error)
    return false
  }

  if (effectiveLeadId) {
    const { error: activityError } = await supabase
      .from('lead_activities')
      .insert({
        lead_id: effectiveLeadId,
        type: 'email_received',
        description: `Email received from ${normalizeEmail(parsed.from.email)}${parsed.subject ? `: ${parsed.subject}` : ''}`,
        metadata: {
          email_thread_id: emailThreadId,
          gmail_message_id: parsed.messageId,
          gmail_thread_id: parsed.threadId || parsed.messageId,
          sender: normalizeEmail(parsed.from.email),
          subject: parsed.subject || null,
        },
      })

    if (activityError) {
      console.error('[Gmail] Failed to create lead activity for inbound email:', activityError)
    }

    if (reopenedFromResolved && emailThreadId) {
      const { error: reopenActivityError } = await supabase
        .from('lead_activities')
        .insert({
          lead_id: effectiveLeadId,
          type: 'email_thread_reopened',
          description: 'Email thread reopened after a new inbound reply',
          metadata: {
            email_thread_id: emailThreadId,
            previous_status: 'resolved',
            new_status: 'awaiting_internal_reply',
            gmail_message_id: parsed.messageId,
            gmail_thread_id: parsed.threadId || parsed.messageId,
            sender: normalizeEmail(parsed.from.email),
            subject: parsed.subject || null,
          },
        })

      if (reopenActivityError) {
        console.error(
          '[Gmail] Failed to create lead activity for reopened email thread:',
          reopenActivityError
        )
      }
    }
  }

  return !!emailThreadId
}

/**
 * Synchronize inbox with incremental updates
 * Uses history API for efficiency when available
 */
export async function syncInbox(
  config: GmailConfig,
  options: SyncInboxOptions = {}
): Promise<SyncResult> {
  const supabase = createServiceClient()

  // Ensure token is fresh
  const { accessToken } = await refreshAccessTokenIfNeeded(config)

  try {
    if (config.provider === 'microsoft') {
      const response = await fetch(
        `${MICROSOFT_GRAPH_API}/me/messages?$top=25&$orderby=receivedDateTime desc`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[MicrosoftMail] Inbox sync failed:', errorText)
        if (response.status === 401) {
          const { accessToken: newToken } = await refreshAccessToken(config)
          return syncInbox({ ...config, access_token: newToken }, options)
        }
        throw new Error(`Microsoft Mail API error: ${response.status}`)
      }

      const data = await response.json()
      const messages = Array.isArray(data?.value) ? data.value : []
      let newMessages = 0
      let updatedThreads = 0
      for (const message of messages) {
        const senderEmail = normalizeEmail(message?.from?.emailAddress?.address || '')
        if (!senderEmail || senderEmail === normalizeEmail(config.account_email || config.google_email)) {
          continue
        }

        const parsed: ParsedEmail = {
          messageId: message.id,
          threadId: message.conversationId || message.id,
          from: {
            email: senderEmail,
            name: message?.from?.emailAddress?.name || '',
          },
          to: (message.toRecipients || []).map((recipient: { emailAddress?: { address?: string, name?: string } }) => ({
            email: recipient.emailAddress?.address || '',
            name: recipient.emailAddress?.name || '',
          })),
          cc: (message.ccRecipients || []).map((recipient: { emailAddress?: { address?: string, name?: string } }) => ({
            email: recipient.emailAddress?.address || '',
            name: recipient.emailAddress?.name || '',
          })),
          subject: message.subject || '',
          bodyText: message.bodyPreview || '',
          bodyHtml: message.body?.content || '',
          snippet: message.bodyPreview || '',
          internalDate: message.receivedDateTime || new Date().toISOString(),
          labels: [],
          hasAttachments: Boolean(message.hasAttachments),
          attachments: [],
        }
        const leadId = await matchLeadByEmail(config.property_id, senderEmail)
        const stored = await persistInboundMessage({ supabase, config, parsed, leadId })
        if (stored) {
          newMessages += 1
          updatedThreads += 1
        }
      }

      await supabase
        .from('email_configurations')
        .update({
          last_sync_at: new Date().toISOString(),
        })
        .eq('id', config.id)

      return { newMessages, updatedThreads }
    }

    let newMessages = 0
    let updatedThreads = 0
    const startHistoryId = config.history_id || options.historyIdHint || null
    let historySyncCompleted = false

    if (startHistoryId) {
      // Incremental sync using history API
      const response = await fetch(
        `${GMAIL_API}/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      )

      if (!response.ok) {
        console.error('[Gmail] History sync failed, falling back to full sync')
        // Fall through to full sync below
      } else {
        historySyncCompleted = true
        const data = await response.json()
        const history = data.history || []
        const historyId = data.historyId

        for (const entry of history) {
          if (entry.messagesAdded) {
            for (const item of entry.messagesAdded) {
              try {
                const parsed = await getMessage(config, item.message.id)
                const senderEmail = normalizeEmail(parsed.from.email)

                if (senderEmail === normalizeEmail(config.google_email)) {
                  continue
                }

                const leadId = await matchLeadByEmail(config.property_id, senderEmail)
                const stored = await persistInboundMessage({
                  supabase,
                  config,
                  parsed: {
                    ...parsed,
                    from: { ...parsed.from, email: senderEmail },
                  },
                  leadId,
                })

                if (stored) {
                  newMessages += 1
                  updatedThreads += 1
                }
              } catch (err) {
                console.error('[Gmail] Error processing message in history:', err)
              }
            }
          }
        }

        // Update history ID and last sync
        if (historyId || options.historyIdHint) {
          await supabase
            .from('email_configurations')
            .update({
              history_id: historyId || options.historyIdHint || startHistoryId,
              last_sync_at: new Date().toISOString(),
            })
            .eq('id', config.id)
        }
      }
    }

    // If no history cursor exists or history sync failed, do initial/full sync.
    if (!startHistoryId || !historySyncCompleted) {
      const recentMessages = await listRecentMessages(config, { maxResults: 50 })

      for (const msg of recentMessages) {
        try {
          const parsed = await getMessage(config, msg.id)
          const senderEmail = normalizeEmail(parsed.from.email)

          if (senderEmail === normalizeEmail(config.google_email)) {
            continue
          }

          const leadId = await matchLeadByEmail(config.property_id, senderEmail)
          const stored = await persistInboundMessage({
            supabase,
            config,
            parsed: {
              ...parsed,
              from: { ...parsed.from, email: senderEmail },
            },
            leadId,
          })

          if (stored) {
            newMessages += 1
            updatedThreads += 1
          }
        } catch (err) {
          console.error('[Gmail] Error processing recent message:', err)
        }
      }

      // Update last sync (history_id will be set on next full sync or push notification)
      await supabase
        .from('email_configurations')
        .update({
          last_sync_at: new Date().toISOString(),
        })
        .eq('id', config.id)
    }

    return {
      newMessages,
      updatedThreads,
    }
  } catch (error) {
    console.error('[Gmail] Error syncing inbox:', error)
    throw error
  }
}

// ============================================================================
// Push Notifications (Watch)
// ============================================================================

/**
 * Set up Gmail push notifications via Cloud Pub/Sub
 */
export async function setupWatch(config: GmailConfig): Promise<string> {
  if (config.provider === 'microsoft') {
    return config.watch_expiration || ''
  }

  // Ensure token is fresh
  const { accessToken } = await refreshAccessTokenIfNeeded(config)
  const supabase = createServiceClient()

  try {
    const topic = process.env.GMAIL_WATCH_TOPIC || 'projects/your-project/topics/gmail-watch'

    const response = await fetch(`${GMAIL_API}/watch`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topicName: topic,
        labelIds: ['INBOX'],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Gmail] Setup watch failed:', errorText)

      // Retry once if 401
      if (response.status === 401) {
        const { accessToken: newToken } = await refreshAccessToken(config)
        return setupWatch({ ...config, access_token: newToken })
      }

      throw new Error(`Gmail API error: ${response.status}`)
    }

    const data = await response.json()
    const expiration = data.expiration

    // Store watch expiration
    await supabase
      .from('email_configurations')
      .update({
        watch_expiration: new Date(parseInt(expiration)).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', config.id)

    console.log(`[Gmail] Watch set up with expiration: ${expiration}`)

    return expiration
  } catch (error) {
    console.error('[Gmail] Error setting up watch:', error)
    throw error
  }
}

// ============================================================================
// Message Parsing
// ============================================================================

/**
 * Parse Gmail API message format to ParsedEmail
 */
export function parseGmailMessage(message: GmailApiMessage): ParsedEmail {
  const headers = message.payload?.headers || []
  const parts = message.payload?.parts || []

  // Extract headers
  const getHeader = (name: string): string => {
    const header = headers.find((h) => h.name === name)
    return header?.value || ''
  }

  // Parse email addresses from "Name <email@domain.com>" format
  const parseEmailAddress = (str: string): { email: string; name: string } => {
    const match = str.match(/^([^<]*)<([^>]+)>$/)
    if (match) {
      return {
        name: match[1].trim(),
        email: match[2].trim(),
      }
    }
    return {
      name: '',
      email: str.trim(),
    }
  }

  const from = parseEmailAddress(getHeader('From'))
  const to = getHeader('To')
    .split(',')
    .filter(Boolean)
    .map(parseEmailAddress)
  const cc = getHeader('Cc')
    .split(',')
    .filter(Boolean)
    .map(parseEmailAddress)

  // Parse body - handle multipart MIME
  let bodyText = ''
  let bodyHtml = ''
  const attachments: ParsedEmail['attachments'] = []

  const extractBody = (part: GmailMessagePart | undefined): void => {
    if (!part) return

    const mimeType = part.mimeType || ''
    const data = part.body?.data || ''

    if (mimeType === 'text/plain' && !bodyText) {
      bodyText = decodeBase64Url(data)
    } else if (mimeType === 'text/html' && !bodyHtml) {
      bodyHtml = decodeBase64Url(data)
    } else if (mimeType.startsWith('multipart/')) {
      // Recursively process multipart children
      const children = part.parts || []
      for (const child of children) {
        extractBody(child)
      }
    }

    // Extract attachments
    if (part.filename && part.filename.length > 0) {
      attachments.push({
        name: part.filename,
        mimeType,
        size: part.body?.size || 0,
        attachmentId: part.body?.attachmentId || '',
      })
    }
  }

  // Extract from root payload
  if (message.payload?.mimeType?.startsWith('multipart/')) {
    for (const part of parts) {
      extractBody(part)
    }
  } else {
    extractBody(message.payload)
  }

  // Use snippet as fallback for body
  if (!bodyText && !bodyHtml) {
    bodyText = message.snippet || ''
  }

  return {
    messageId: message.id,
    threadId: message.threadId,
    from,
    to,
    cc,
    subject: getHeader('Subject'),
    bodyText,
    bodyHtml,
    snippet: message.snippet || '',
    internalDate: message.internalDate ? new Date(parseInt(message.internalDate)).toISOString() : '',
    labels: message.labelIds || [],
    hasAttachments: attachments.length > 0,
    attachments,
  }
}

// ============================================================================
// Lead Matching
// ============================================================================

/**
 * Check if sender is a known lead
 */
export async function matchLeadByEmail(propertyId: string, email: string): Promise<string | null> {
  const supabase = createServiceClient()

  try {
    // Query leads by property/email only, matching the current schema.
    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .select('id')
      .eq('property_id', propertyId)
      .eq('email', normalizeEmail(email))
      .maybeSingle()

    if (leadError || !leadData) {
      return null
    }

    return leadData.id
  } catch (error) {
    console.error('[Gmail] Error matching lead by email:', error)
    return null
  }
}

// ============================================================================
// Encoding/Decoding
// ============================================================================

/**
 * Encode string to base64url format (Gmail API standard)
 */
export function encodeBase64Url(str: string): string {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Decode base64url to string
 */
export function decodeBase64Url(str: string): string {
  // Add padding if needed
  const padding = (4 - (str.length % 4)) % 4
  const padded = str + '='.repeat(padding)

  // Replace base64url chars with standard base64
  const base64 = padded
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  return Buffer.from(base64, 'base64').toString('utf-8')
}

// ============================================================================
// MIME Message Building
// ============================================================================

/**
 * Build RFC 2822 MIME message with proper headers and multipart support
 */
export function buildMimeMessage(
  message: EmailMessage,
  fromEmail: string,
  signature: string | null
): string {
  const messageBoundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(7)}`

  // Build subject
  const subject = message.subject
    .split('\n')[0]
    .substring(0, 256)

  // Prepare body text
  let bodyText = message.bodyText || ''
  if (signature) {
    bodyText += '\n\n--\n' + signature
  }

  // Build headers
  const headers: Record<string, string> = {
    'From': fromEmail,
    'To': message.to.join(', '),
    'Subject': subject,
    'MIME-Version': '1.0',
    'Content-Type': `multipart/alternative; boundary="${messageBoundary}"`,
  }

  if (message.cc && message.cc.length > 0) {
    headers['Cc'] = message.cc.join(', ')
  }

  if (message.replyToMessageId) {
    headers['In-Reply-To'] = `<${message.replyToMessageId}>`
    headers['References'] = `<${message.replyToMessageId}>`
  }

  // Build header section
  let mimeMessage = ''
  for (const [key, value] of Object.entries(headers)) {
    mimeMessage += `${key}: ${value}\r\n`
  }
  mimeMessage += '\r\n'

  // Build multipart body
  // Plain text part
  mimeMessage += `--${messageBoundary}\r\n`
  mimeMessage += 'Content-Type: text/plain; charset="UTF-8"\r\n'
  mimeMessage += 'Content-Transfer-Encoding: 7bit\r\n\r\n'
  mimeMessage += bodyText + '\r\n'

  // HTML part (if provided)
  if (message.bodyHtml) {
    let bodyHtml = message.bodyHtml
    if (signature) {
      bodyHtml += '<br><br><pre>' + escapeHtml(signature) + '</pre>'
    }

    mimeMessage += `--${messageBoundary}\r\n`
    mimeMessage += 'Content-Type: text/html; charset="UTF-8"\r\n'
    mimeMessage += 'Content-Transfer-Encoding: 7bit\r\n\r\n'
    mimeMessage += bodyHtml + '\r\n'
  }

  // Close multipart
  mimeMessage += `--${messageBoundary}--`

  return mimeMessage
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (char) => map[char])
}
