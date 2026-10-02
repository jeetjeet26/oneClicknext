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
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (profileError) {
      ctx.logError(500, profileError, { operation: 'load_property_organization' })
      return serverError(profileError, ctx.responseHeaders)
    }
    if (!profile?.org_id) {
      ctx.logSuccess(403, { reason: 'no_org_found' })
      return forbidden(ctx.responseHeaders)
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

// Property creation and editing now require retained, versioned requests.
export async function POST(){const{data:{user},error}=await(await createClient()).auth.getUser();return NextResponse.json({error:error||!user?'Unauthorized':'Use the guided property setup to create a recoverable property.'},{status:error||!user?401:410})}
export async function PATCH(){const{data:{user},error}=await(await createClient()).auth.getUser();return NextResponse.json({error:error||!user?'Unauthorized':'Use the recorded property editor to review and save changes.'},{status:error||!user?401:410})}

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
