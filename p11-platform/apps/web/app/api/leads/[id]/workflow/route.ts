import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  badRequest,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

type WorkflowActionStatus = 'sent' | 'failed' | 'skipped' | string

type WorkflowAction = {
  id: string
  step_number: number
  action_type: string
  status: WorkflowActionStatus | null
  created_at: string | null
  error_message?: string | null
}

type WorkflowVisibility = {
  counts: {
    pending: number
    skipped: number
    retried: number
    paused: number
    failed: number
  }
  recent_issues: Array<{
    id: string
    step_number: number
    action_type: string
    status: 'failed' | 'skipped'
    created_at: string | null
    error_message: string | null
  }>
}

function deriveWorkflowVisibility(workflow: {
  status: string | null
  workflow?: { steps?: unknown } | null
  actions?: WorkflowAction[]
}): WorkflowVisibility {
  const steps = Array.isArray(workflow.workflow?.steps) ? workflow.workflow.steps : []
  const actions = Array.isArray(workflow.actions) ? workflow.actions : []
  const attemptsByStep = new Map<number, WorkflowAction[]>()

  for (const action of actions) {
    if (!Number.isInteger(action.step_number)) continue
    const existing = attemptsByStep.get(action.step_number) || []
    existing.push(action)
    attemptsByStep.set(action.step_number, existing)
  }

  let skipped = 0
  let failed = 0
  let retried = 0
  let completedStepCount = 0

  for (let stepNumber = 0; stepNumber < steps.length; stepNumber++) {
    const attempts = (attemptsByStep.get(stepNumber) || []).sort((a, b) =>
      (a.created_at || '').localeCompare(b.created_at || '')
    )
    if (attempts.length === 0) continue

    if (attempts.length > 1) {
      retried += 1
    }

    const latestAttempt = attempts[attempts.length - 1]
    if (latestAttempt?.status === 'skipped') {
      skipped += 1
      completedStepCount += 1
    } else if (latestAttempt?.status === 'failed') {
      failed += 1
    } else if (latestAttempt?.status === 'sent') {
      completedStepCount += 1
    }
  }

  const pending = Math.max(steps.length - completedStepCount - failed, 0)
  const paused = workflow.status === 'paused' ? 1 : 0

  const recent_issues = actions
    .filter((action): action is WorkflowAction & { status: 'failed' | 'skipped' } => (
      action.status === 'failed' || action.status === 'skipped'
    ))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 5)
    .map((action) => ({
      id: action.id,
      step_number: action.step_number,
      action_type: action.action_type,
      status: action.status,
      created_at: action.created_at,
      error_message: action.error_message || null,
    }))

  return {
    counts: {
      pending,
      skipped,
      retried,
      paused,
      failed,
    },
    recent_issues,
  }
}

// GET - Get workflow status for a lead
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext(request, '/api/leads/[id]/workflow')
  ctx.logStart()
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const { id: leadId } = await params

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('property_id')
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

    // Get lead workflow with definition and actions
    const { data: workflow, error } = await supabase
      .from('lead_workflows')
      .select(`
        id,
        current_step,
        status,
        last_action_at,
        next_action_at,
        created_at,
        workflow:workflow_definitions(
          id,
          name,
          steps,
          exit_conditions
        ),
        actions:workflow_actions(
          id,
          step_number,
          action_type,
          status,
          created_at,
          error_message
        )
      `)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      ctx.logError(500, error, { operation: 'fetch_lead_workflow', leadId })
      return serverError(error, ctx.responseHeaders)
    }

    const workflowWithVisibility = workflow
      ? {
          ...workflow,
          action_visibility: deriveWorkflowVisibility(workflow),
        }
      : null

    ctx.logSuccess(200, { leadId, hasWorkflow: !!workflow })
    return NextResponse.json({ workflow: workflowWithVisibility }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_lead_workflow' })
    return serverError(error, ctx.responseHeaders)
  }
}

// PATCH - Update workflow status (pause, resume, stop)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext(request, '/api/leads/[id]/workflow')
  ctx.logStart()
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const { id: leadId } = await params
    const body = await request.json()
    const { action } = body

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('property_id')
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

    if (!action || !['pause', 'resume', 'stop'].includes(action)) {
      ctx.logSuccess(400, { reason: 'invalid_action', action })
      return badRequest('Invalid action', ctx.responseHeaders)
    }

    const statusMap: Record<string, string> = {
      pause: 'paused',
      resume: 'active',
      stop: 'stopped',
    }

    const updateData: Record<string, unknown> = {
      status: statusMap[action],
      processing_started_at: null,
      processing_expires_at: null,
      updated_at: new Date().toISOString(),
    }

    if (action === 'resume') {
      // Recalculate next action time when resuming
      updateData.next_action_at = new Date().toISOString()
    } else {
      updateData.next_action_at = null
    }

    const { data: workflow, error } = await supabase
      .from('lead_workflows')
      .update(updateData)
      .eq('lead_id', leadId)
      .eq('status', action === 'resume' ? 'paused' : 'active')
      .select()
      .single()

    if (error) {
      ctx.logError(500, error, { operation: 'update_lead_workflow', leadId, action })
      return serverError(error, ctx.responseHeaders)
    }

    ctx.logSuccess(200, { leadId, action, workflowId: workflow?.id || null })
    return NextResponse.json({ workflow }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'update_lead_workflow' })
    return serverError(error, ctx.responseHeaders)
  }
}

