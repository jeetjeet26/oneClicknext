/**
 * Send Message API
 * Sends a manual message to a lead via SMS or Email
 */

import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { sendMessage, replaceTemplateVariables, type TemplateVariables } from '@/utils/services/messaging'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  badRequest,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

type LeadWithProperty = {
  id: string
  property_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  status: string | null
  properties: { id: string; name: string } | { id: string; name: string }[] | null
}

function getLeadPropertyName(lead: LeadWithProperty): string {
  const property = Array.isArray(lead.properties) ? lead.properties[0] : lead.properties
  return property?.name || 'Our Property'
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext(request, '/api/leads/[id]/send-message')
  ctx.logStart()

  try {
    const supabaseAuth = await createClient()
    
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const { id: leadId } = await params
    const body = await request.json()
    const { channel, message, templateSlug } = body

    if (!channel || !['sms', 'email'].includes(channel)) {
      ctx.logSuccess(400, { reason: 'invalid_channel', channel })
      return badRequest('Invalid channel', ctx.responseHeaders)
    }

    if (!message && !templateSlug) {
      ctx.logSuccess(400, { reason: 'missing_message_or_template' })
      return badRequest('Message or template slug required', ctx.responseHeaders)
    }

    const supabase = createServiceClient()

    // Get lead info
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*, properties(id, name)')
      .eq('id', leadId)
      .single()

    if (leadError || !lead) {
      ctx.logSuccess(404, { reason: 'lead_not_found', leadId })
      return notFound('Lead', ctx.responseHeaders)
    }

    if (!lead.property_id) {
      ctx.logSuccess(404, { reason: 'property_not_found', leadId })
      return notFound('Property', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, lead.property_id)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', leadId, propertyId: lead.property_id })
      return forbidden(ctx.responseHeaders)
    }

    // Determine message content
    let messageBody = message
    let messageSubject = body.subject

    if (templateSlug) {
      // Get template
      const { data: template, error: templateError } = await supabase
        .from('follow_up_templates')
        .select('*')
        .eq('property_id', lead.property_id)
        .eq('slug', templateSlug)
        .single()

      if (templateError || !template) {
        ctx.logSuccess(404, { reason: 'template_not_found', templateSlug })
        return notFound('Template', ctx.responseHeaders)
      }

      // Prepare variables
      const variables: TemplateVariables = {
        first_name: lead.first_name || undefined,
        last_name: lead.last_name || undefined,
        property_name: getLeadPropertyName(lead as LeadWithProperty),
        tour_link: process.env.NEXT_PUBLIC_SITE_URL
          ? `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/leads`
          : undefined,
      }

      messageBody = replaceTemplateVariables(template.body, variables)
      if (template.subject) {
        messageSubject = replaceTemplateVariables(template.subject, variables)
      }
    }

    // Validate recipient
    const recipient = channel === 'sms' ? lead.phone : lead.email
    if (!recipient) {
      ctx.logSuccess(400, { reason: 'missing_recipient', channel, leadId })
      return badRequest(
        `Lead has no ${channel === 'sms' ? 'phone number' : 'email address'}`,
        ctx.responseHeaders
      )
    }

    // Send message
    const result = await sendMessage({
      to: recipient,
      channel,
      body: messageBody,
      subject: messageSubject || `Message from ${getLeadPropertyName(lead as LeadWithProperty)}`,
      propertyName: getLeadPropertyName(lead as LeadWithProperty),
    })

    if (!result.success) {
      ctx.logError(500, result.error || 'Failed to send message', {
        operation: 'send_message',
        channel,
        leadId,
      })
      return serverError(result.error || 'Failed to send message', ctx.responseHeaders)
    }

    // Log to conversation
    let conversationId: string

    const { data: existingConv } = await supabase
      .from('conversations')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('channel', channel)
      .single()

    if (existingConv) {
      conversationId = existingConv.id
    } else {
      const { data: newConv } = await supabase
        .from('conversations')
        .insert({
          lead_id: lead.id,
          property_id: lead.property_id,
          channel,
        })
        .select('id')
        .single()
      conversationId = newConv?.id || ''
    }

    if (conversationId) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: messageBody,
      })
    }

    // Update lead
    await supabase
      .from('leads')
      .update({
        last_contacted_at: new Date().toISOString(),
        status: lead.status === 'new' ? 'contacted' : lead.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id)

    ctx.logSuccess(200, { leadId, channel, messageId: result.messageId || null })

    return NextResponse.json(
      {
        success: true,
        messageId: result.messageId,
        channel,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'send_message' })
    return serverError(error, ctx.responseHeaders)
  }
}

