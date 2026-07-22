/**
 * ReviewFlow role checks.
 *
 * Connection mutation and response approval/post actions are manager/admin
 * operations; RLS enforces this at the database layer for direct access and
 * these helpers enforce it for service-role route logic.
 */

import { createClient } from '@/utils/supabase/server'

export type ReviewerRole = 'admin' | 'manager' | 'member' | 'unknown'

export async function loadProfileRole(userId: string): Promise<ReviewerRole> {
  const supabase = await createClient()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !profile?.role) return 'unknown'
  if (profile.role === 'admin' || profile.role === 'manager' || profile.role === 'member') {
    return profile.role
  }
  return 'unknown'
}

export function isManagerRole(role: ReviewerRole): boolean {
  return role === 'admin' || role === 'manager'
}
