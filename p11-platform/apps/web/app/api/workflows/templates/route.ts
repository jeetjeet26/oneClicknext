/**
 * Workflow Templates API
 * Manage workflow definitions and templates
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { adminLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter'
import { validateBody, workflowCreateSchema } from '@/utils/services/validation'
import { unauthorized, forbidden, badRequest, serverError, rateLimited } from '@/utils/services/api-helpers'
import { auditLog, getRequestIp } from '@/utils/services/audit-logger'

// GET - List workflow templates for a property
export async function GET(req: NextRequest) {
  try {
    // Rate limit
    const rlKey = getRateLimitKey(req, 'workflows-get')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) return rateLimited(rateLimitHeaders(rl))

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return unauthorized()

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    if (!propertyId) return badRequest('propertyId required')

    // Org ownership check
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      auditLog({ eventType: 'property_access_denied', userId: user.id, propertyId, ip: getRequestIp(req), resource: 'workflows/templates' })
      return forbidden()
    }

    const serviceClient = createServiceClient()

    // Get all workflow definitions for this property
    const { data: workflows, error } = await serviceClient
      .from('workflow_definitions')
      .select('*')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })

    if (error) return serverError(error)

    return NextResponse.json({ workflows: workflows || [] })
  } catch (error) {
    return serverError(error)
  }
}

// POST - Create or seed default workflow templates
export async function POST(req: NextRequest) {
  try {
    // Rate limit
    const rlKey = getRateLimitKey(req, 'workflows-post')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) return rateLimited(rateLimitHeaders(rl))

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return unauthorized()

    const rawBody = await req.json()
    const { propertyId, seedDefaults } = rawBody

    if (!propertyId) return badRequest('propertyId required')

    // Org ownership check
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      auditLog({ eventType: 'property_access_denied', userId: user.id, propertyId, ip: getRequestIp(req), resource: 'workflows/templates/create' })
      return forbidden()
    }

    const serviceClient = createServiceClient()

    // If seedDefaults is true, create the 3 default workflow templates
    if (seedDefaults) {
      // First, create default templates if they don't exist
      const defaultTemplates = [
        {
          property_id: propertyId,
          slug: 'new-lead-welcome',
          name: 'New Lead Welcome',
          channel: 'sms',
          body: 'Hi {first_name}! Thanks for your interest in {property_name}. We\'d love to help you find your perfect home. Reply with any questions or visit us to schedule a tour: {tour_link}',
          variables: ['first_name', 'property_name', 'tour_link'],
          is_active: true
        },
        {
          property_id: propertyId,
          slug: 'new-lead-email',
          name: 'New Lead Email Follow-up',
          channel: 'email',
          subject: 'Welcome to {property_name}!',
          body: 'Hi {first_name},\n\nThank you for your interest in {property_name}! We\'re excited to help you find your perfect home.\n\nWould you like to schedule a tour? You can book a time that works for you here: {tour_link}\n\nIf you have any questions, feel free to reply to this email or give us a call.\n\nBest regards,\nThe {property_name} Team',
          variables: ['first_name', 'property_name', 'tour_link'],
          is_active: true
        },
        {
          property_id: propertyId,
          slug: 'new-lead-reminder',
          name: 'New Lead Reminder',
          channel: 'sms',
          body: 'Hi {first_name}, just following up! Still interested in touring {property_name}? We have availability this week. Book here: {tour_link}',
          variables: ['first_name', 'property_name', 'tour_link'],
          is_active: true
        },
        {
          property_id: propertyId,
          slug: 'tour-no-show-followup',
          name: 'Tour No-Show Follow-up',
          channel: 'sms',
          body: 'Hi {first_name}, we missed you at {property_name} today! Life happens - would you like to reschedule? {tour_link}',
          variables: ['first_name', 'property_name', 'tour_link'],
          is_active: true
        },
        {
          property_id: propertyId,
          slug: 'tour-no-show-email',
          name: 'Tour No-Show Email',
          channel: 'email',
          subject: 'We missed you at {property_name}',
          body: 'Hi {first_name},\n\nWe noticed you weren\'t able to make your tour at {property_name} today. No worries - we understand things come up!\n\nWe\'d still love to show you around. You can reschedule at a time that works better for you: {tour_link}\n\nLooking forward to meeting you!\n\nBest,\nThe {property_name} Team',
          variables: ['first_name', 'property_name', 'tour_link'],
          is_active: true
        },
        {
          property_id: propertyId,
          slug: 'post-tour-thanks',
          name: 'Post-Tour Thank You',
          channel: 'sms',
          body: 'Thanks for touring {property_name} today, {first_name}! What did you think? Any questions? We\'re here to help!',
          variables: ['first_name', 'property_name'],
          is_active: true
        },
        {
          property_id: propertyId,
          slug: 'post-tour-application',
          name: 'Post-Tour Application Reminder',
          channel: 'email',
          subject: 'Ready to apply at {property_name}?',
          body: 'Hi {first_name},\n\nIt was great meeting you at {property_name}! We hope you loved what you saw.\n\nIf you\'re ready to make {property_name} your new home, you can start your application online anytime. We\'re here if you have any questions!\n\nBest regards,\nThe {property_name} Team',
          variables: ['first_name', 'property_name'],
          is_active: true
        }
      ]

      // Insert templates (ignore conflicts)
      const { error: templatesError } = await serviceClient
        .from('follow_up_templates')
        .upsert(defaultTemplates, {
          onConflict: 'property_id,slug',
          ignoreDuplicates: true
        })

      if (templatesError) return serverError(templatesError)

      // Now create the 3 default workflow definitions
      const defaultWorkflows = [
        {
          property_id: propertyId,
          name: 'New Lead Nurture',
          description: 'Automated follow-up sequence for new leads',
          trigger_on: 'lead_created',
          steps: [
            { id: 0, delay_hours: 0.083, action: 'sms', template_slug: 'new-lead-welcome' },
            { id: 1, delay_hours: 24, action: 'email', template_slug: 'new-lead-email' },
            { id: 2, delay_hours: 48, action: 'sms', template_slug: 'new-lead-reminder' }
          ],
          exit_conditions: ['tour_booked', 'leased', 'lost'],
          is_active: true
        },
        {
          property_id: propertyId,
          name: 'Tour No-Show Recovery',
          description: 'Re-engage leads who missed their scheduled tour',
          trigger_on: 'tour_no_show',
          steps: [
            { id: 0, delay_hours: 2, action: 'sms', template_slug: 'tour-no-show-followup' },
            { id: 1, delay_hours: 24, action: 'email', template_slug: 'tour-no-show-email' }
          ],
          exit_conditions: ['tour_booked', 'leased', 'lost'],
          is_active: true
        },
        {
          property_id: propertyId,
          name: 'Post-Tour Follow-Up',
          description: 'Nurture leads after they complete a tour',
          trigger_on: 'tour_completed',
          steps: [
            { id: 0, delay_hours: 4, action: 'sms', template_slug: 'post-tour-thanks' },
            { id: 1, delay_hours: 48, action: 'email', template_slug: 'post-tour-application' }
          ],
          exit_conditions: ['leased', 'lost'],
          is_active: true
        }
      ]

      const { data: createdWorkflows, error: workflowsError } = await serviceClient
        .from('workflow_definitions')
        .insert(defaultWorkflows)
        .select()

      if (workflowsError) return serverError(workflowsError)

      auditLog({ eventType: 'workflow_triggered', userId: user.id, propertyId, details: { action: 'seed_defaults' } })

      return NextResponse.json({
        success: true,
        message: 'Default workflows and templates created',
        workflows: createdWorkflows,
        templatesCount: defaultTemplates.length
      })
    }

    // If not seeding defaults, create a custom workflow — validate input
    const validation = validateBody(rawBody, workflowCreateSchema)
    if (!validation.success) return badRequest(validation.error)

    const { name, description, trigger_on, steps, exit_conditions, is_active } = validation.data

    if (!name || !trigger_on || !steps) {
      return badRequest('name, trigger_on, and steps are required')
    }

    const { data: workflow, error } = await serviceClient
      .from('workflow_definitions')
      .insert({
        property_id: propertyId,
        name,
        description: description || null,
        trigger_on,
        steps,
        exit_conditions: exit_conditions || ['tour_booked', 'leased', 'lost'],
        is_active: is_active !== undefined ? is_active : true
      })
      .select()
      .single()

    if (error) return serverError(error)

    return NextResponse.json({ workflow }, { status: 201 })
  } catch (error) {
    return serverError(error)
  }
}

// PATCH - Update a workflow template
export async function PATCH(req: NextRequest) {
  try {
    // Rate limit
    const rlKey = getRateLimitKey(req, 'workflows-patch')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) return rateLimited(rateLimitHeaders(rl))

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return unauthorized()

    const body = await req.json()
    const { workflowId, is_active, name, description, steps, exit_conditions } = body

    if (!workflowId) return badRequest('workflowId required')

    const serviceClient = createServiceClient()

    // Look up the workflow to get its property_id for access check
    const { data: existingWorkflow } = await serviceClient
      .from('workflow_definitions')
      .select('property_id')
      .eq('id', workflowId)
      .single()

    if (!existingWorkflow) return badRequest('Workflow not found')
    if (typeof existingWorkflow.property_id !== 'string') {
      return badRequest('Workflow property missing')
    }

    const workflowPropertyId = existingWorkflow.property_id

    // Org ownership check
    const access = await validatePropertyAccess(user.id, workflowPropertyId)
    if (!access.authorized) {
      auditLog({ eventType: 'property_access_denied', userId: user.id, propertyId: workflowPropertyId, ip: getRequestIp(req), resource: 'workflows/templates/update' })
      return forbidden()
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    }

    if (is_active !== undefined) updateData.is_active = is_active
    if (name) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (steps) updateData.steps = steps
    if (exit_conditions) updateData.exit_conditions = exit_conditions

    const { data: workflow, error } = await serviceClient
      .from('workflow_definitions')
      .update(updateData)
      .eq('id', workflowId)
      .select()
      .single()

    if (error) return serverError(error)

    return NextResponse.json({ workflow })
  } catch (error) {
    return serverError(error)
  }
}
