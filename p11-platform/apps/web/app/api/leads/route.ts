import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { startWorkflow } from '@/utils/services/workflow-processor'
import { syncLeadToCRM } from '@/utils/services/crm-sync'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { logAuditEvent } from '@/utils/audit'
import {
  badRequest,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'
import { upsertLeadByContact } from '@/utils/services/lead-upsert'

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/leads')
  ctx.logStart()

  try {
    const supabase = await createClient()
    
    // Verify authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')
    const status = searchParams.get('status')
    const source = searchParams.get('source')
    const search = searchParams.get('search')
    const sortBy = searchParams.get('sortBy') || 'created_at'
    const sortOrder = searchParams.get('sortOrder') || 'desc'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '25'), 1), 100)
    const offset = (page - 1) * limit

    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID is required', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId })
      return forbidden(ctx.responseHeaders)
    }

    // Build query
    let query = supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .eq('property_id', propertyId)

    // Apply filters
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }
    
    if (source && source !== 'all') {
      query = query.eq('source', source)
    }

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`)
    }

    // Apply sorting
    const validSortColumns = ['created_at', 'updated_at', 'first_name', 'last_name', 'status', 'source']
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at'
    query = query.order(sortColumn, {
      ascending: sortOrder === 'asc',
      nullsFirst: false,
    })

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: leads, error, count } = await query

    if (error) {
      ctx.logError(500, error, { operation: 'fetch_leads', propertyId })
      return serverError(error, ctx.responseHeaders)
    }

    // Get distinct sources for filters
    const { data: sources } = await supabase
      .from('leads')
      .select('source')
      .eq('property_id', propertyId)
      .not('source', 'is', null)

    const uniqueSources = [...new Set(sources?.map(s => s.source).filter(Boolean))]

    // Get status counts
    const { data: statusCounts } = await supabase
      .from('leads')
      .select('status')
      .eq('property_id', propertyId)

    const statusSummary = statusCounts?.reduce((acc, lead) => {
      if (!lead.status) return acc
      acc[lead.status] = (acc[lead.status] || 0) + 1
      return acc
    }, {} as Record<string, number>) || {}

    ctx.logSuccess(200, {
      propertyId,
      page,
      limit,
      total: count || 0,
    })

    return NextResponse.json(
      {
        leads: leads || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
        },
        filters: {
          sources: uniqueSources,
          statuses: ['new', 'contacted', 'tour_booked', 'toured', 'leased', 'lost'],
        },
        statusSummary,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_leads' })
    return serverError(error, ctx.responseHeaders)
  }
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/leads')
  ctx.logStart()

  try {
    const supabase = await createClient()
    
    // Verify authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const body = await request.json()
    const { 
      propertyId, 
      firstName, 
      lastName, 
      email, 
      phone, 
      source, 
      moveInDate, 
      bedrooms, 
      notes 
    } = body

    // Validation
    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID is required', ctx.responseHeaders)
    }
    if (!firstName || !lastName) {
      ctx.logSuccess(400, { reason: 'missing_name' })
      return badRequest('First and last name are required', ctx.responseHeaders)
    }
    if (!email && !phone) {
      ctx.logSuccess(400, { reason: 'missing_contact_method' })
      return badRequest('Email or phone is required', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId })
      return forbidden(ctx.responseHeaders)
    }

    const repeatIntent = [
      moveInDate ? `Move-in: ${moveInDate}` : null,
      bedrooms ? `Bedrooms: ${bedrooms}` : null,
      notes ? `Notes: ${notes}` : null,
    ].filter(Boolean).join(', ')
    const leadResult = await upsertLeadByContact({
      client: supabase,
      propertyId,
      email,
      phone,
      create: {
        first_name: firstName,
        last_name: lastName,
        email: email || null,
        phone: phone || null,
        source: source || 'manual',
        move_in_date: moveInDate || null,
        bedrooms: bedrooms || null,
        notes: notes || null,
        status: 'new',
      },
      update: {
        first_name: firstName,
        last_name: lastName,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(moveInDate ? { move_in_date: moveInDate } : {}),
        ...(bedrooms ? { bedrooms } : {}),
        ...(notes ? { notes } : {}),
      },
      repeatActivity: {
        description: repeatIntent
          ? `Returned via ${source || 'manual'}: ${repeatIntent}`
          : `Returned via ${source || 'manual'}`,
        metadata: {
          source: source || 'manual',
          moveInDate,
          bedrooms,
          notes,
        },
      },
    })
    const lead = leadResult.lead

    // CRM sync and workflow start are non-blocking; isolate them so one failure
    // does not suppress the other automation side effect.
    try {
      await syncLeadToCRM(propertyId, lead.id, {
        first_name: firstName,
        last_name: lastName,
        email: email || undefined,
        phone: phone || undefined,
        source: source || 'manual',
        status: lead.status || undefined,
        move_in_date: moveInDate || undefined,
        bedrooms: bedrooms || undefined,
        notes: notes || undefined,
      })
    } catch (crmSyncError) {
      console.error('[Leads API] Failed to sync lead to CRM:', crmSyncError)
    }

    if (!leadResult.isExisting) {
      try {
        const workflowResult = await startWorkflow(lead.id, propertyId, 'lead_created')
        if (workflowResult.success) {
          console.log(`[Leads API] Started workflow ${workflowResult.workflowId} for lead ${lead.id}`)
        }
      } catch (workflowError) {
        console.error('[Leads API] Failed to start workflow:', workflowError)
      }
    }

    // Log audit event
    await logAuditEvent({
      action: leadResult.isExisting ? 'update' : 'create',
      entityType: 'lead',
      entityId: lead.id,
      entityName: `${firstName} ${lastName}`,
      details: { source: source || 'manual', email, phone },
      request
    })

    const responseStatus = leadResult.isExisting ? 200 : 201
    ctx.logSuccess(responseStatus, {
      propertyId,
      leadId: lead.id,
      updatedExisting: leadResult.isExisting,
    })

    return NextResponse.json(
      { lead, updatedExisting: leadResult.isExisting },
      { status: responseStatus, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'create_lead' })
    return serverError(error, ctx.responseHeaders)
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/leads')
  ctx.logStart()

  try {
    const supabase = await createClient()
    
    // Verify authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const body = await request.json()
    const { 
      leadId, 
      status, 
      notes, 
      moveInDate, 
      bedrooms,
      firstName,
      lastName,
      email,
      phone,
      source
    } = body

    if (!leadId) {
      ctx.logSuccess(400, { reason: 'missing_lead_id' })
      return badRequest('Lead ID is required', ctx.responseHeaders)
    }

    const { data: existingLead, error: leadError } = await supabase
      .from('leads')
      .select('property_id')
      .eq('id', leadId)
      .single()

    if (leadError || !existingLead) {
      ctx.logSuccess(404, { reason: 'lead_not_found', leadId })
      return notFound('Lead', ctx.responseHeaders)
    }

    if (!existingLead.property_id) {
      ctx.logSuccess(404, { reason: 'property_not_found', leadId })
      return notFound('Property', ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, existingLead.property_id)
    if (!access.authorized) {
      ctx.logSuccess(403, {
        reason: 'forbidden',
        propertyId: existingLead.property_id,
        leadId,
      })
      return forbidden(ctx.responseHeaders)
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (status) {
      const validStatuses = ['new', 'contacted', 'tour_booked', 'toured', 'leased', 'lost']
      if (!validStatuses.includes(status)) {
        ctx.logSuccess(400, { reason: 'invalid_status', status })
        return badRequest('Invalid status', ctx.responseHeaders)
      }
      updateData.status = status
      
      // If status is contacted, update last_contacted_at
      if (status === 'contacted') {
        updateData.last_contacted_at = new Date().toISOString()
      }
      
      // If leased or lost, stop workflow
      if (status === 'leased' || status === 'lost') {
        await supabase
          .from('lead_workflows')
          .update({
            status: status === 'leased' ? 'converted' : 'stopped',
            next_action_at: null,
            processing_started_at: null,
            processing_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('lead_id', leadId)
          .eq('status', 'active')
      }
    }

    if (notes !== undefined) updateData.notes = notes
    if (moveInDate !== undefined) updateData.move_in_date = moveInDate
    if (bedrooms !== undefined) updateData.bedrooms = bedrooms
    if (firstName !== undefined) updateData.first_name = firstName
    if (lastName !== undefined) updateData.last_name = lastName
    if (email !== undefined) updateData.email = email
    if (phone !== undefined) updateData.phone = phone
    if (source !== undefined) updateData.source = source

    const { data: lead, error } = await supabase
      .from('leads')
      .update(updateData)
      .eq('id', leadId)
      .select()
      .single()

    if (error) {
      ctx.logError(500, error, { operation: 'update_lead', leadId })
      return serverError(error, ctx.responseHeaders)
    }

    // Log audit event
    await logAuditEvent({
      action: 'update',
      entityType: 'lead',
      entityId: leadId,
      entityName: `${lead.first_name} ${lead.last_name}`,
      details: { status, notes: notes ? 'updated' : undefined },
      request
    })

    ctx.logSuccess(200, { leadId, status: status || null })

    return NextResponse.json({ lead }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'update_lead' })
    return serverError(error, ctx.responseHeaders)
  }
}

