import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logAuditEvent } from '@/utils/audit'
import {
  badRequest,
  forbidden,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

// GET - List all properties for the user's organization
export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/properties')
  ctx.logStart()

  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    // Get user's profile to find their organization
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      ctx.logSuccess(200, { reason: 'no_org_found' })
      return NextResponse.json(
        { properties: [], message: 'No organization found' },
        { headers: ctx.responseHeaders }
      )
    }

    // Get all properties for the organization
    const { data: properties, error } = await supabase
      .from('properties')
      .select(`
        id,
        name,
        address,
        settings,
        created_at,
        org_id
      `)
      .eq('org_id', profile.org_id)
      .order('name', { ascending: true })

    if (error) {
      ctx.logError(500, error, { operation: 'list_properties' })
      return serverError(error, ctx.responseHeaders)
    }

    // Get stats for each property
    const propertiesWithStats = await Promise.all(
      (properties || []).map(async (property) => {
        // Get leads count
        const { count: leadsCount } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('property_id', property.id)

        // Get documents count
        const { count: docsCount } = await supabase
          .from('documents')
          .select('*', { count: 'exact', head: true })
          .eq('property_id', property.id)

        return {
          ...property,
          stats: {
            leads: leadsCount || 0,
            documents: docsCount || 0,
          },
        }
      })
    )

    ctx.logSuccess(200, {
      orgId: profile.org_id,
      propertyCount: propertiesWithStats.length,
    })

    return NextResponse.json(
      { properties: propertiesWithStats },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'list_properties' })
    return serverError(error, ctx.responseHeaders)
  }
}

// POST - Create a new property
export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/properties')
  ctx.logStart()

  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    const body = await request.json()
    const { name, address, settings } = body

    if (!name) {
      ctx.logSuccess(400, { reason: 'missing_property_name' })
      return badRequest('Property name is required', ctx.responseHeaders)
    }

    // Get user's profile to find their organization
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      ctx.logSuccess(400, { reason: 'no_org_found' })
      return badRequest('No organization found', ctx.responseHeaders)
    }

    // Check if user has permission (admin or manager)
    if (!['admin', 'manager'].includes(profile.role || '')) {
      ctx.logSuccess(403, { reason: 'insufficient_permissions' })
      return forbidden(ctx.responseHeaders)
    }

    // Create the property
    const { data: property, error } = await supabase
      .from('properties')
      .insert({
        name,
        org_id: profile.org_id,
        address: address || {},
        settings: settings || {},
      })
      .select()
      .single()

    if (error) {
      ctx.logError(500, error, { operation: 'create_property' })
      return serverError(error, ctx.responseHeaders)
    }

    // Log audit event
    await logAuditEvent({
      action: 'create',
      entityType: 'property',
      entityId: property.id,
      entityName: name,
      details: { address: address?.city || address?.street },
      request
    })

    ctx.logSuccess(201, { propertyId: property.id })

    return NextResponse.json(
      { property },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'create_property' })
    return serverError(error, ctx.responseHeaders)
  }
}

// PATCH - Update a property
export async function PATCH(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/properties')
  ctx.logStart()

  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    const body = await request.json()
    const { id, name, address, settings } = body

    if (!id) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID is required', ctx.responseHeaders)
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      ctx.logSuccess(400, { reason: 'no_org_found' })
      return badRequest('No organization found', ctx.responseHeaders)
    }

    // Check if user has permission
    if (!['admin', 'manager'].includes(profile.role || '')) {
      ctx.logSuccess(403, { reason: 'insufficient_permissions' })
      return forbidden(ctx.responseHeaders)
    }

    // Update the property
    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (address !== undefined) updateData.address = address
    if (settings !== undefined) updateData.settings = settings

    const { data: property, error } = await supabase
      .from('properties')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', profile.org_id) // Ensure property belongs to user's org
      .select()
      .single()

    if (error) {
      ctx.logError(500, error, { operation: 'update_property', propertyId: id })
      return serverError(error, ctx.responseHeaders)
    }

    // Log audit event
    await logAuditEvent({
      action: 'update',
      entityType: 'property',
      entityId: id,
      entityName: property?.name || 'Unknown Property',
      details: { updated_fields: Object.keys(updateData) },
      request
    })

    ctx.logSuccess(200, { propertyId: id, updatedFields: Object.keys(updateData) })

    return NextResponse.json(
      { property },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'update_property' })
    return serverError(error, ctx.responseHeaders)
  }
}

// DELETE - Delete a property
export async function DELETE(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/properties')
  ctx.logStart()

  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID is required', ctx.responseHeaders)
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      ctx.logSuccess(400, { reason: 'no_org_found' })
      return badRequest('No organization found', ctx.responseHeaders)
    }

    // Check if user has permission (admin only for delete)
    if ((profile.role || '') !== 'admin') {
      ctx.logSuccess(403, { reason: 'insufficient_permissions' })
      return forbidden(ctx.responseHeaders)
    }

    // Get property name before deletion for audit log
    const { data: propertyToDelete } = await supabase
      .from('properties')
      .select('name')
      .eq('id', id)
      .single()

    // Delete the property (cascades to related data)
    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('id', id)
      .eq('org_id', profile.org_id)

    if (error) {
      ctx.logError(500, error, { operation: 'delete_property', propertyId: id })
      return serverError(error, ctx.responseHeaders)
    }

    // Log audit event
    await logAuditEvent({
      action: 'delete',
      entityType: 'property',
      entityId: id,
      entityName: propertyToDelete?.name || 'Unknown',
      request
    })

    ctx.logSuccess(200, { propertyId: id })

    return NextResponse.json(
      { success: true },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'delete_property' })
    return serverError(error, ctx.responseHeaders)
  }
}
