import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logAuditEvent } from '@/utils/audit'
import {
  badRequest,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

// GET - Fetch team members for the current user's organization
export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/team')
  ctx.logStart()

  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    // Get current user's profile to find their org_id
    const { data: currentProfile, error: profileError } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (profileError || !currentProfile?.org_id) {
      ctx.logSuccess(404, { reason: 'profile_not_found' })
      return notFound('Profile', ctx.responseHeaders)
    }

    // Fetch all team members in the same organization
    const { data: members, error: membersError } = await supabase
      .from('profiles')
      .select(`
        id,
        full_name,
        role,
        created_at
      `)
      .eq('org_id', currentProfile.org_id)
      .order('created_at', { ascending: true })

    if (membersError) {
      throw membersError
    }

    // Get auth user info for emails (need to use admin API)
    const { data: authUsers } = await supabase.auth.admin.listUsers()

    // Map profiles to include email from auth users
    const teamMembers = members?.map(member => {
      const authUser = authUsers?.users?.find(u => u.id === member.id)
      return {
        id: member.id,
        name: member.full_name || 'Unknown',
        email: authUser?.email || 'Email not available',
        role: member.role || 'viewer',
        status: authUser?.email_confirmed_at ? 'active' : 'pending',
        created_at: member.created_at,
      }
    }) || []

    ctx.logSuccess(200, {
      orgId: currentProfile.org_id,
      memberCount: teamMembers.length,
    })

    return NextResponse.json({ members: teamMembers }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_team' })
    return serverError(error, ctx.responseHeaders)
  }
}

// POST - Invite a new team member
export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/team')
  ctx.logStart()

  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    const { email, role } = await request.json()

    if (!email) {
      ctx.logSuccess(400, { reason: 'missing_email' })
      return badRequest('Email is required', ctx.responseHeaders)
    }

    // Validate role
    const validRoles = ['admin', 'manager', 'viewer']
    const memberRole = validRoles.includes(role) ? role : 'viewer'

    // Get current user's profile to find their org_id
    const { data: currentProfile, error: profileError } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (profileError || !currentProfile?.org_id) {
      ctx.logSuccess(404, { reason: 'profile_not_found' })
      return notFound('Profile', ctx.responseHeaders)
    }

    // Only admins can invite new members
    if (currentProfile.role !== 'admin') {
      ctx.logSuccess(403, { reason: 'insufficient_permissions' })
      return forbidden(ctx.responseHeaders)
    }

    // Get organization name for the invite email
    await supabase
      .from('organizations')
      .select('name')
      .eq('id', currentProfile.org_id)
      .single()

    // Invite user via Supabase Auth
    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          role: memberRole,
          org_id: currentProfile.org_id,
          invited_by: user.id,
        },
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`,
      }
    )

    if (inviteError) {
      // Check if user already exists
      if (inviteError.message?.includes('already registered')) {
        ctx.logSuccess(400, { reason: 'already_registered', email })
        return badRequest(
          'This email is already registered. Ask them to request access.',
          ctx.responseHeaders
        )
      }
      throw inviteError
    }

    // Create a profile for the invited user (will be linked on first login)
    if (inviteData?.user) {
      await supabase.from('profiles').insert({
        id: inviteData.user.id,
        org_id: currentProfile.org_id,
        role: memberRole,
        full_name: email.split('@')[0], // Use email prefix as temp name
      })
    }

    // Log the audit event
    await logAuditEvent({
      action: 'invite',
      entityType: 'team_member',
      entityId: inviteData?.user?.id || null,
      entityName: email,
      details: { role: memberRole },
      request
    })

    ctx.logSuccess(200, {
      invitedUserId: inviteData?.user?.id || null,
      email,
      role: memberRole,
    })

    return NextResponse.json(
      { 
        success: true, 
        message: `Invitation sent to ${email}`,
        user: inviteData?.user
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'invite_team_member' })
    return serverError(error, ctx.responseHeaders)
  }
}

// PATCH - Update a team member's role
export async function PATCH(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/team')
  ctx.logStart()

  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    const { memberId, role } = await request.json()

    if (!memberId || !role) {
      ctx.logSuccess(400, { reason: 'missing_member_or_role' })
      return badRequest('memberId and role are required', ctx.responseHeaders)
    }

    // Validate role
    const validRoles = ['admin', 'manager', 'viewer']
    if (!validRoles.includes(role)) {
      ctx.logSuccess(400, { reason: 'invalid_role', role })
      return badRequest('Invalid role', ctx.responseHeaders)
    }

    // Get current user's profile
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!currentProfile?.org_id || currentProfile.role !== 'admin') {
      ctx.logSuccess(403, { reason: 'insufficient_permissions' })
      return forbidden(ctx.responseHeaders)
    }

    // Prevent self-demotion if only admin
    if (memberId === user.id && role !== 'admin') {
      const { count: adminCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', currentProfile.org_id)
        .eq('role', 'admin')

      if (adminCount === 1) {
        ctx.logSuccess(400, { reason: 'only_admin_demote_blocked', memberId })
        return badRequest(
          'Cannot demote the only admin. Promote another admin first.',
          ctx.responseHeaders
        )
      }
    }

    // Get member info for audit log
    const { data: memberProfile } = await supabase
      .from('profiles')
      .select('full_name, role')
      .eq('id', memberId)
      .single()

    const previousRole = memberProfile?.role

    // Update the role
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', memberId)
      .eq('org_id', currentProfile.org_id)

    if (updateError) throw updateError

    // Log the audit event
    await logAuditEvent({
      action: 'role_change',
      entityType: 'team_member',
      entityId: memberId,
      entityName: memberProfile?.full_name || 'Unknown',
      details: { previous_role: previousRole, new_role: role },
      request
    })

    ctx.logSuccess(200, { memberId, newRole: role })

    return NextResponse.json({ success: true }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'update_team_role' })
    return serverError(error, ctx.responseHeaders)
  }
}

// DELETE - Remove a team member
export async function DELETE(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/team')
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
    const memberId = searchParams.get('memberId')

    if (!memberId) {
      ctx.logSuccess(400, { reason: 'missing_member_id' })
      return badRequest('memberId is required', ctx.responseHeaders)
    }

    // Prevent self-removal
    if (memberId === user.id) {
      ctx.logSuccess(400, { reason: 'self_removal_blocked', memberId })
      return badRequest('Cannot remove yourself', ctx.responseHeaders)
    }

    // Get current user's profile
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!currentProfile?.org_id || currentProfile.role !== 'admin') {
      ctx.logSuccess(403, { reason: 'insufficient_permissions' })
      return forbidden(ctx.responseHeaders)
    }

    // Get member info for audit log before removal
    const { data: memberProfile } = await supabase
      .from('profiles')
      .select('full_name, role')
      .eq('id', memberId)
      .single()

    // Remove from profiles (sets org_id to null, keeping the user account)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ org_id: null })
      .eq('id', memberId)
      .eq('org_id', currentProfile.org_id)

    if (updateError) throw updateError

    // Log the audit event
    await logAuditEvent({
      action: 'delete',
      entityType: 'team_member',
      entityId: memberId,
      entityName: memberProfile?.full_name || 'Unknown',
      details: { role: memberProfile?.role },
      request
    })

    ctx.logSuccess(200, { memberId })

    return NextResponse.json({ success: true }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'remove_team_member' })
    return serverError(error, ctx.responseHeaders)
  }
}

