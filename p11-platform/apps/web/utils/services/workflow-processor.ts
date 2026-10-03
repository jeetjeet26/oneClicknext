import {createServiceClient} from '@/utils/supabase/admin'
export {processWorkflowDeliveries as processWorkflows} from './workflow-delivery'
export type {ProcessResult} from './workflow-delivery'
export interface WorkflowStep {id:number;delay_hours:number;action:'sms'|'email'|'wait';template_slug:string}

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
    .maybeSingle()

  // If no workflow found, auto-seed defaults and retry
  if (error || !workflow) {
    await seedDefaultWorkflows(supabase, propertyId)

    const retry = await supabase
      .from('workflow_definitions')
      .select('id, steps')
      .eq('property_id', propertyId)
      .eq('trigger_on', trigger)
      .eq('is_active', true)
      .maybeSingle()

    workflow = retry.data
    error = retry.error
  }

  if (error || !workflow) {
    return { success: false, error: 'No active workflow found after seeding defaults' }
  }

  const steps = workflow.steps as unknown as WorkflowStep[]
  if (!Array.isArray(steps) || steps.length === 0) {
    return { success: false, error: 'Workflow has no executable steps' }
  }
  const firstStep = steps[0]
  const nextActionAt = new Date(Date.now() + (firstStep?.delay_hours || 0) * 60 * 60 * 1000)

  // Prevent duplicate active workflows for same lead + workflow definition.
  const { data: existing } = await supabase
    .from('lead_workflows')
    .select('id')
    .eq('lead_id', leadId)
    .eq('workflow_id', workflow.id)
    .in('status', ['active', 'paused'])
    .limit(1)
    .maybeSingle()

  if (existing?.id) {
    return { success: true, workflowId: existing.id }
  }

  // Create lead workflow
  const { data: leadWorkflow, error: insertError } = await supabase
    .from('lead_workflows')
    .insert({
      lead_id: leadId,
      workflow_id: workflow.id,
      current_step: 0,
      status: 'active',
      next_action_at: nextActionAt.toISOString(),
      processing_started_at: null,
      processing_expires_at: null,
    })
    .select('id')
    .single()

  if (insertError) {
    const { data: existingAfterInsertError } = await supabase
      .from('lead_workflows')
      .select('id')
      .eq('lead_id', leadId)
      .eq('workflow_id', workflow.id)
      .in('status', ['active', 'paused'])
      .limit(1)
      .maybeSingle()

    if (existingAfterInsertError?.id) {
      return { success: true, workflowId: existingAfterInsertError.id }
    }

    return { success: false, error: insertError.message }
  }

  return { success: true, workflowId: leadWorkflow?.id }
}
