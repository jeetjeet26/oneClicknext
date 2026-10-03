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

import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {ReviewStoreError} from './analysis-store'
import {NextResponse} from 'next/server'
export async function requireReviewOperator(propertyId:string){const{data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)throw new ReviewStoreError('Sign in to review this property.',401);if(!(await validatePropertyAccess(user.id,propertyId)).authorized)throw new ReviewStoreError('This property is unavailable to your account.',403);return user.id}
export function reviewError(error:unknown){return NextResponse.json({error:error instanceof ReviewStoreError?error.message:'The saved review workspace could not be loaded. Reload and try again.'},{status:error instanceof ReviewStoreError?error.status:503})}
