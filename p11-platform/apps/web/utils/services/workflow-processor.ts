/**
 * TourSpark Workflow Processor
 * Processes automated follow-up workflows
 */

import { createServiceClient } from '@/utils/supabase/admin'
import { sendMessage, replaceTemplateVariables, type TemplateVariables } from './messaging'

/**
 * Retry helper with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1)
        console.warn(`[Workflow] Retry ${attempt}/${maxAttempts} after ${delay}ms:`, lastError.message)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

export interface WorkflowStep {
  id: number
  delay_hours: number
  action: 'sms' | 'email' | 'wait'
  template_slug: string
}

export interface LeadWorkflowRow {
  id: string
  lead_id: string
  workflow_id: string
  current_step: number
  status: 'active' | 'paused' | 'completed' | 'converted' | 'stopped'
  last_action_at: string
  next_action_at: string | null
  workflow_definitions: {
    id: string
    name: string
    steps: WorkflowStep[]
    exit_conditions: string[]
    property_id: string
  }
  leads: {
    id: string
    first_name: string
    last_name: string
    email: string
    phone: string | null
    status: string
  }
}

export interface ProcessResult {
  processed: number
  succeeded: number
  failed: number
  errors: string[]
}

/**
 * Process all pending workflow actions
 * Should be called by a CRON job every 10 minutes
 */
export async function processWorkflows(): Promise<ProcessResult> {
  const supabase = createServiceClient()
  const result: ProcessResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  }

  try {
    // Get all active workflows that are due for next action
    const { data: workflows, error } = await supabase
      .from('lead_workflows')
      .select(`
        id,
        lead_id,
        workflow_id,
        current_step,
        status,
        last_action_at,
        next_action_at,
        workflow_definitions!inner (
          id,
          name,
          steps,
          exit_conditions,
          property_id
        ),
        leads!inner (
          id,
          first_name,
          last_name,
          email,
          phone,
          status
        )
      `)
      .eq('status', 'active')
      .lte('next_action_at', new Date().toISOString())
      .limit(100) // Process in batches

    if (error) {
      console.error('[Workflow] Error fetching workflows:', error)
      result.errors.push(error.message)
      return result
    }

    if (!workflows || workflows.length === 0) {
      console.log('[Workflow] No pending workflows to process')
      return result
    }

    console.log(`[Workflow] Processing ${workflows.length} workflows`)

    // Process each workflow
    for (const workflow of workflows as unknown as LeadWorkflowRow[]) {
      result.processed++

      try {
        const processResult = await processWorkflowStep(supabase, workflow)
        if (processResult.success) {
          result.succeeded++
        } else {
          result.failed++
          if (processResult.error) {
            result.errors.push(`Lead ${workflow.lead_id}: ${processResult.error}`)
          }
        }
      } catch (err) {
        result.failed++
        result.errors.push(`Lead ${workflow.lead_id}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    console.log(`[Workflow] Processed: ${result.processed}, Succeeded: ${result.succeeded}, Failed: ${result.failed}`)
    return result
  } catch (err) {
    console.error('[Workflow] Fatal error:', err)
    result.errors.push(err instanceof Error ? err.message : 'Unknown fatal error')
    return result
  }
}

/**
 * Process a single workflow step
 */
async function processWorkflowStep(
  supabase: ReturnType<typeof createServiceClient>,
  workflow: LeadWorkflowRow
): Promise<{ success: boolean; error?: string }> {
  const lead = workflow.leads
  const definition = workflow.workflow_definitions
  const steps = definition.steps as WorkflowStep[]
  const currentStepIndex = workflow.current_step

  // Check if workflow is complete
  if (currentStepIndex >= steps.length) {
    await updateWorkflowStatus(supabase, workflow.id, 'completed')
    return { success: true }
  }

  // Check exit conditions (lead status)
  const exitConditions = definition.exit_conditions as string[]
  if (exitConditions.includes(lead.status)) {
    const newStatus = lead.status === 'leased' ? 'converted' : 'stopped'
    await updateWorkflowStatus(supabase, workflow.id, newStatus)
    return { success: true }
  }

  const currentStep = steps[currentStepIndex]

  // Get template for this step
  const { data: template, error: templateError } = await supabase
    .from('follow_up_templates')
    .select('*')
    .eq('property_id', definition.property_id)
    .eq('slug', currentStep.template_slug)
    .single()

  if (templateError || !template) {
    console.error(`[Workflow] Template not found: ${currentStep.template_slug}`)
    return { success: false, error: `Template not found: ${currentStep.template_slug}` }
  }

  // Get property info
  const { data: property } = await supabase
    .from('properties')
    .select('name, settings')
    .eq('id', definition.property_id)
    .single()

  // Prepare template variables
  const variables: TemplateVariables = {
    first_name: lead.first_name,
    last_name: lead.last_name,
    property_name: property?.name || 'Our Property',
    tour_link: `${process.env.NEXT_PUBLIC_SITE_URL}/book-tour/${lead.id}`,
  }

  // Replace variables in template
  const messageBody = replaceTemplateVariables(template.body, variables)
  const messageSubject = template.subject 
    ? replaceTemplateVariables(template.subject, variables) 
    : undefined

  // Determine recipient
  const recipient = currentStep.action === 'sms' ? lead.phone : lead.email
  if (!recipient) {
    console.warn(`[Workflow] No ${currentStep.action} address for lead ${lead.id}`)
    // Skip this step and move to next
    await advanceWorkflow(supabase, workflow, steps)
    return { success: true }
  }

  // Send message with retry
  const sendResult = await withRetry(() => sendMessage({
    to: recipient,
    channel: currentStep.action as 'sms' | 'email',
    body: messageBody,
    subject: messageSubject,
    propertyName: property?.name,
  }))

  // Log the action
  await supabase.from('workflow_actions').insert({
    lead_workflow_id: workflow.id,
    step_number: currentStepIndex,
    action_type: currentStep.action,
    template_id: template.id,
    status: sendResult.success ? 'sent' : 'failed',
    external_id: sendResult.messageId,
    error_message: sendResult.error,
  })

  // Also log to messages/conversations for visibility
  if (sendResult.success) {
    // Get or create conversation
    let conversationId: string

    const { data: existingConv } = await supabase
      .from('conversations')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('channel', currentStep.action)
      .single()

    if (existingConv) {
      conversationId = existingConv.id
    } else {
      const { data: newConv } = await supabase
        .from('conversations')
        .insert({
          lead_id: lead.id,
          property_id: definition.property_id,
          channel: currentStep.action,
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

    // Update lead's last_contacted_at
    await supabase
      .from('leads')
      .update({ 
        last_contacted_at: new Date().toISOString(),
        status: lead.status === 'new' ? 'contacted' : lead.status,
      })
      .eq('id', lead.id)
  }

  // Advance to next step
  await advanceWorkflow(supabase, workflow, steps)

  return { success: sendResult.success, error: sendResult.error }
}

/**
 * Advance workflow to next step
 */
async function advanceWorkflow(
  supabase: ReturnType<typeof createServiceClient>,
  workflow: LeadWorkflowRow,
  steps: WorkflowStep[]
) {
  const nextStepIndex = workflow.current_step + 1
  const now = new Date()

  if (nextStepIndex >= steps.length) {
    // Workflow complete
    await supabase
      .from('lead_workflows')
      .update({
        current_step: nextStepIndex,
        status: 'completed',
        last_action_at: now.toISOString(),
        next_action_at: null,
        updated_at: now.toISOString(),
      })
      .eq('id', workflow.id)
  } else {
    // Calculate next action time
    const nextStep = steps[nextStepIndex]
    const nextActionAt = new Date(now.getTime() + nextStep.delay_hours * 60 * 60 * 1000)

    await supabase
      .from('lead_workflows')
      .update({
        current_step: nextStepIndex,
        last_action_at: now.toISOString(),
        next_action_at: nextActionAt.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', workflow.id)
  }
}

/**
 * Update workflow status
 */
async function updateWorkflowStatus(
  supabase: ReturnType<typeof createServiceClient>,
  workflowId: string,
  status: 'active' | 'paused' | 'completed' | 'converted' | 'stopped'
) {
  await supabase
    .from('lead_workflows')
    .update({
      status,
      updated_at: new Date().toISOString(),
      next_action_at: status === 'active' ? new Date().toISOString() : null,
    })
    .eq('id', workflowId)
}

/**
 * Default workflow definitions + templates to seed for new properties
 */
const DEFAULT_TEMPLATES = [
  {
    slug: 'tour-no-show-followup',
    name: 'Tour No-Show Follow-up',
    channel: 'sms',
    body: 'Hi {first_name}, we missed you at {property_name} today! Life happens - would you like to reschedule? {tour_link}',
    variables: ['first_name', 'property_name', 'tour_link'],
  },
  {
    slug: 'tour-no-show-email',
    name: 'Tour No-Show Email',
    channel: 'email',
    subject: 'We missed you at {property_name}',
    body: 'Hi {first_name},\n\nWe noticed you weren\'t able to make your tour at {property_name} today. No worries - we understand things come up!\n\nWe\'d still love to show you around. You can reschedule at a time that works better for you: {tour_link}\n\nLooking forward to meeting you!\n\nBest,\nThe {property_name} Team',
    variables: ['first_name', 'property_name', 'tour_link'],
  },
  {
    slug: 'post-tour-thanks',
    name: 'Post-Tour Thank You',
    channel: 'sms',
    body: 'Thanks for touring {property_name} today, {first_name}! What did you think? Any questions? We\'re here to help!',
    variables: ['first_name', 'property_name'],
  },
  {
    slug: 'post-tour-application',
    name: 'Post-Tour Application Reminder',
    channel: 'email',
    subject: 'Ready to apply at {property_name}?',
    body: 'Hi {first_name},\n\nIt was great meeting you at {property_name}! We hope you loved what you saw.\n\nIf you\'re ready to make {property_name} your new home, you can start your application online anytime. We\'re here if you have any questions!\n\nBest regards,\nThe {property_name} Team',
    variables: ['first_name', 'property_name'],
  },
  {
    slug: 'intro_sms',
    name: 'New Lead Welcome',
    channel: 'sms',
    body: 'Hi {first_name}! Thanks for your interest in {property_name}. We\'d love to help you find your perfect home. Reply with any questions or visit us to schedule a tour: {tour_link}',
    variables: ['first_name', 'property_name', 'tour_link'],
  },
  {
    slug: 'amenities_email',
    name: 'New Lead Email Follow-up',
    channel: 'email',
    subject: 'Welcome to {property_name}!',
    body: 'Hi {first_name},\n\nThank you for your interest in {property_name}! We\'re excited to help you find your perfect home.\n\nWould you like to schedule a tour? You can book a time that works for you here: {tour_link}\n\nBest regards,\nThe {property_name} Team',
    variables: ['first_name', 'property_name', 'tour_link'],
  },
  {
    slug: 'tour_invite',
    name: 'Tour Invite Reminder',
    channel: 'sms',
    body: 'Hi {first_name}, just following up! Still interested in touring {property_name}? We have availability this week. Book here: {tour_link}',
    variables: ['first_name', 'property_name', 'tour_link'],
  },
]

const DEFAULT_WORKFLOWS = [
  {
    name: 'New Lead Nurture',
    description: 'Automated follow-up sequence for new leads',
    trigger_on: 'lead_created',
    steps: [
      { id: 0, delay_hours: 0.083, action: 'sms', template_slug: 'intro_sms' },
      { id: 1, delay_hours: 24, action: 'email', template_slug: 'amenities_email' },
      { id: 2, delay_hours: 48, action: 'sms', template_slug: 'tour_invite' },
    ],
    exit_conditions: ['tour_booked', 'leased', 'lost'],
  },
  {
    name: 'Tour No-Show Recovery',
    description: 'Re-engage leads who missed their scheduled tour',
    trigger_on: 'tour_no_show',
    steps: [
      { id: 0, delay_hours: 2, action: 'sms', template_slug: 'tour-no-show-followup' },
      { id: 1, delay_hours: 24, action: 'email', template_slug: 'tour-no-show-email' },
    ],
    exit_conditions: ['tour_booked', 'leased', 'lost'],
  },
  {
    name: 'Post-Tour Follow-Up',
    description: 'Nurture leads after they complete a tour',
    trigger_on: 'tour_completed',
    steps: [
      { id: 0, delay_hours: 4, action: 'sms', template_slug: 'post-tour-thanks' },
      { id: 1, delay_hours: 48, action: 'email', template_slug: 'post-tour-application' },
    ],
    exit_conditions: ['leased', 'lost'],
  },
]

/**
 * Seed default workflow definitions and templates for a property
 * Called automatically when startWorkflow finds no definitions
 */
async function seedDefaultWorkflows(
  supabase: ReturnType<typeof createServiceClient>,
  propertyId: string
): Promise<void> {
  console.log(`[Workflow] Auto-seeding default workflows for property ${propertyId}`)

  // Seed templates (ignore conflicts)
  const templates = DEFAULT_TEMPLATES.map(t => ({
    ...t,
    property_id: propertyId,
    is_active: true,
  }))

  await supabase
    .from('follow_up_templates')
    .upsert(templates, { onConflict: 'property_id,slug', ignoreDuplicates: true })

  // Seed workflow definitions (only if not already present for this trigger)
  for (const wf of DEFAULT_WORKFLOWS) {
    const { data: existing } = await supabase
      .from('workflow_definitions')
      .select('id')
      .eq('property_id', propertyId)
      .eq('trigger_on', wf.trigger_on)
      .maybeSingle()

    if (!existing) {
      await supabase.from('workflow_definitions').insert({
        ...wf,
        property_id: propertyId,
        is_active: true,
      })
    }
  }

  console.log(`[Workflow] Seeded defaults for property ${propertyId}`)
}

/**
 * Start a workflow for a lead
 */
export async function startWorkflow(
  leadId: string,
  propertyId: string,
  trigger: string = 'lead_created'
): Promise<{ success: boolean; workflowId?: string; error?: string }> {
  const supabase = createServiceClient()

  // Find active workflow for this trigger
  let { data: workflow, error } = await supabase
    .from('workflow_definitions')
    .select('id, steps')
    .eq('property_id', propertyId)
    .eq('trigger_on', trigger)
    .eq('is_active', true)
    .single()

  // If no workflow found, auto-seed defaults and retry
  if (error || !workflow) {
    await seedDefaultWorkflows(supabase, propertyId)

    const retry = await supabase
      .from('workflow_definitions')
      .select('id, steps')
      .eq('property_id', propertyId)
      .eq('trigger_on', trigger)
      .eq('is_active', true)
      .single()

    workflow = retry.data
    error = retry.error
  }

  if (error || !workflow) {
    return { success: false, error: 'No active workflow found after seeding defaults' }
  }

  const steps = workflow.steps as WorkflowStep[]
  const firstStep = steps[0]
  const nextActionAt = new Date(Date.now() + (firstStep?.delay_hours || 0) * 60 * 60 * 1000)

  // Create lead workflow
  const { data: leadWorkflow, error: insertError } = await supabase
    .from('lead_workflows')
    .insert({
      lead_id: leadId,
      workflow_id: workflow.id,
      current_step: 0,
      status: 'active',
      next_action_at: nextActionAt.toISOString(),
    })
    .select('id')
    .single()

  if (insertError) {
    return { success: false, error: insertError.message }
  }

  return { success: true, workflowId: leadWorkflow?.id }
}

