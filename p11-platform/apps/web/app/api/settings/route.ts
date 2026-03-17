import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import {
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

type OrgSettings = {
  timezone?: string
  notifications?: {
    new_leads?: boolean
    ai_handoff?: boolean
    daily_summary?: boolean
    weekly_report?: boolean
  }
}

type UserPreferences = {
  theme?: 'light' | 'dark' | 'system'
  accent_color?: 'indigo' | 'purple' | 'blue' | 'emerald'
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

// GET - Fetch settings for the current user's organization and preferences
export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/settings')
  ctx.logStart()

  const supabaseAuth = await createClient()
  
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  
  if (authError || !user) {
    ctx.logSuccess(401, { reason: 'unauthorized' })
    return unauthorized(ctx.responseHeaders)
  }

  const supabase = createServiceClient()

  try {
    // Get user's profile with preferences
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('org_id, preferences')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.org_id) {
      ctx.logSuccess(404, { reason: 'profile_not_found' })
      return notFound('Profile', ctx.responseHeaders)
    }

    // Get organization settings
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, subscription_tier, settings')
      .eq('id', profile.org_id)
      .single()

    if (orgError) {
      throw orgError
    }

    ctx.logSuccess(200, { orgId: profile.org_id })

    return NextResponse.json(
      {
        organization: {
          id: org.id,
          name: org.name,
          subscription_tier: org.subscription_tier,
          settings: org.settings || {},
        },
        preferences: profile.preferences || {},
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_settings' })
    return serverError(error, ctx.responseHeaders)
  }
}

// PATCH - Update settings
export async function PATCH(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/settings')
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
    const { organization, preferences } = body as {
      organization?: { name?: string; settings?: OrgSettings }
      preferences?: UserPreferences
    }

    // Get user's profile to find their org
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      ctx.logSuccess(404, { reason: 'profile_not_found' })
      return notFound('Profile', ctx.responseHeaders)
    }

    const results: { organization?: boolean; preferences?: boolean } = {}

    // Update organization settings (admin/manager only for org settings)
    if (organization) {
      if (!['admin', 'manager'].includes(profile.role || '')) {
        ctx.logSuccess(403, { reason: 'insufficient_permissions' })
        return forbidden(ctx.responseHeaders)
      }

      const orgUpdate: Record<string, unknown> = {}
      
      if (organization.name !== undefined) {
        orgUpdate.name = organization.name
      }
      
      if (organization.settings !== undefined) {
        // Merge with existing settings
        const { data: currentOrg } = await supabase
          .from('organizations')
          .select('settings')
          .eq('id', profile.org_id)
          .single()

        const currentOrgSettings = asObject(currentOrg?.settings)
        const currentNotifications = asObject(currentOrgSettings.notifications)

        orgUpdate.settings = {
          ...currentOrgSettings,
          ...organization.settings,
          notifications: {
            ...currentNotifications,
            ...(organization.settings.notifications || {}),
          },
        }
      }

      if (Object.keys(orgUpdate).length > 0) {
        const { error } = await supabase
          .from('organizations')
          .update(orgUpdate)
          .eq('id', profile.org_id)

        if (error) throw error
        results.organization = true
      }
    }

    // Update user preferences (anyone can update their own)
    if (preferences) {
      // Merge with existing preferences
      const { data: currentProfile } = await supabase
        .from('profiles')
        .select('preferences')
        .eq('id', user.id)
        .single()

      const currentPreferences = asObject(currentProfile?.preferences)
      const newPreferences = {
        ...currentPreferences,
        ...preferences,
      }

      const { error } = await supabase
        .from('profiles')
        .update({ preferences: newPreferences })
        .eq('id', user.id)

      if (error) throw error
      results.preferences = true
    }

    ctx.logSuccess(200, { updated: results })

    return NextResponse.json(
      { 
        success: true,
        updated: results,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'update_settings' })
    return serverError(error, ctx.responseHeaders)
  }
}



























