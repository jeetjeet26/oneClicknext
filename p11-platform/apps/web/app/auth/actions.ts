'use server'

import {clientRedirect} from '@/utils/client-portal/routing'

import {recordedCurrentSignOut} from '@/utils/account-sessions/server'
import {headers} from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getAppBaseUrl } from '@/utils/services/runtime-config'

import {localAuthRedirect as localRedirect,accountAuthRedirect}from '@/utils/auth/redirect'

export type AuthState = {
  error?: string
  success?: boolean
}

export async function signIn(
  prevState: AuthState | null,
  formData: FormData
): Promise<AuthState> {
  const supabase = await createClient({userAgent:(await headers()).get('user-agent')})

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const redirectTo = formData.get('redirect') as string | null

  if (!email || !password) {
    return { error: 'Email and password are required' }
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: error.message }
  }

  if(!data.user)return{error:'Your signed-in account could not be confirmed. Please try again.'}
  const {data:profile,error:profileError}=await supabase.from('profiles').select('org_id').eq('id',data.user.id).single()
  if(profileError||!profile)return{error:'Sign-in succeeded, but your account setup could not be read. Please try again.'}
  const identity=await supabase.rpc('client_portal_identity')
  if(identity.error)return{error:'Your account access could not be confirmed. Please try again.'}
  const isClient=!!identity.data&&typeof identity.data==='object'&&!Array.isArray(identity.data)&&identity.data.kind==='client'
  revalidatePath('/', 'layout')
  redirect(isClient?clientRedirect(redirectTo??'/client'):accountAuthRedirect(redirectTo,!!profile.org_id))
}

export async function signUp(
  prevState: AuthState | null,
  formData: FormData
): Promise<AuthState> {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('fullName') as string

  if (!email || !password) {
    return { error: 'Email and password are required' }
  }

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters' }
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
      emailRedirectTo: `${getAppBaseUrl()}/auth/callback?next=${encodeURIComponent(localRedirect(formData.get('redirect') as string|null))}`,
    },
  })

  if (error) {
    return { error: error.message }
  }

  return { 
    success: true,
  }
}

export async function signOut() {
  await recordedCurrentSignOut()
  revalidatePath('/', 'layout')
  redirect('/auth/login')
}

export async function switchTeamAccount(): Promise<void> {
  await recordedCurrentSignOut()
  revalidatePath('/', 'layout')
  redirect('/auth/login?redirect=%2Fjoin%2Fteam')
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const redirectTo = formData.get('redirect') as string | null
  const nextPath = localRedirect(redirectTo)
  
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${getAppBaseUrl()}/auth/callback?next=${encodeURIComponent(nextPath)}`,
    },
  })

  if (error) {
    redirect(`/auth/login?error=${encodeURIComponent(error.message)}`)
  }

  if (data.url) {
    redirect(data.url)
  }
}

export async function forgotPassword(
  prevState: AuthState | null,
  formData: FormData
): Promise<AuthState> {
  const supabase = await createClient()

  const email = formData.get('email') as string

  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Enter a valid email address' }
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getAppBaseUrl()}/auth/reset-password`,
  })

  if (error) {
    return { error: 'A recovery email could not be requested. Wait a moment before trying again.' }
  }

  return { success: true }
}

// Password reset writes run through the recorded, recovery-session-only API.
