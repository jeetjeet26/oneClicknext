/**
 * Auth Guard — validates that an authenticated user's org owns the requested property.
 *
 * Prevents cross-tenant data access by checking the ownership chain:
 *   user → profile.org_id → properties.org_id → match propertyId
 *
 * Usage:
 *   const access = await validatePropertyAccess(userId, propertyId)
 *   if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
 */

import { createServiceClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'

export interface AccessResult {
  authorized: boolean
  orgId?: string
  error?: string
}

/**
 * Validate that the given user owns (or belongs to the org that owns) the given property.
 *
 * Steps:
 *   1. Look up the user's profile to get their org_id
 *   2. Look up the property to get its org_id
 *   3. Compare — they must match
 */
export async function validatePropertyAccess(
  userId: string,
  propertyId: string
): Promise<AccessResult> {
  if (!userId || !propertyId) {
    return { authorized: false, error: 'Missing userId or propertyId' }
  }

  let supabase: ReturnType<typeof createServiceClient> | Awaited<ReturnType<typeof createClient>>
  try {
    // Prefer service-role client for consistent cross-tenant checks.
    supabase = createServiceClient()
  } catch {
    // Fallback for local/dev environments where service key may be absent.
    supabase = await createClient()
  }

  // 1. Get user's org
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', userId)
    .single()

  if (profileError || !profile?.org_id) {
    return { authorized: false, error: 'User profile not found or missing org' }
  }

  // 2. Get property's org
  const { data: property, error: propertyError } = await supabase
    .from('properties')
    .select('org_id')
    .eq('id', propertyId)
    .single()

  if (propertyError || !property) {
    return { authorized: false, error: 'Property not found' }
  }

  // 3. Compare
  if (profile.org_id !== property.org_id) {
    return { authorized: false, error: 'Forbidden' }
  }

  return { authorized: true, orgId: profile.org_id }
}

const CONNECTION_MANAGER_ROLES = ['admin', 'manager']

/**
 * Validate property access AND require an elevated role (admin/manager).
 * Used for surfaces that manage credentials, connections, and configuration.
 */
export async function validatePropertyManagerAccess(
  userId: string,
  propertyId: string
): Promise<AccessResult> {
  if (!userId || !propertyId) {
    return { authorized: false, error: 'Missing userId or propertyId' }
  }

  let supabase: ReturnType<typeof createServiceClient> | Awaited<ReturnType<typeof createClient>>
  try {
    supabase = createServiceClient()
  } catch {
    supabase = await createClient()
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', userId)
    .single()

  if (profileError || !profile?.org_id) {
    return { authorized: false, error: 'User profile not found or missing org' }
  }

  if (!CONNECTION_MANAGER_ROLES.includes(profile.role || '')) {
    return { authorized: false, error: 'Requires admin or manager role' }
  }

  const { data: property, error: propertyError } = await supabase
    .from('properties')
    .select('org_id')
    .eq('id', propertyId)
    .single()

  if (propertyError || !property) {
    return { authorized: false, error: 'Property not found' }
  }

  if (profile.org_id !== property.org_id) {
    return { authorized: false, error: 'Forbidden' }
  }

  return { authorized: true, orgId: profile.org_id }
}

/**
 * Helper: get the authenticated user + validate property access in one call.
 * Returns user info and access result, or an error response.
 */
export async function authenticateAndAuthorize(propertyId: string): Promise<{
  user: { id: string; email?: string } | null
  access: AccessResult
  error?: string
}> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return {
      user: null,
      access: { authorized: false, error: 'Unauthorized' },
      error: 'Unauthorized',
    }
  }

  const access = await validatePropertyAccess(user.id, propertyId)
  return { user, access }
}
