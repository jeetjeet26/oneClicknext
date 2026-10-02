import {clientRedirect} from '@/utils/client-portal/routing'
import {accountAuthRedirect}from '@/utils/auth/redirect'
import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error) {
      // Check if user needs onboarding (no org_id)
      const { data: { user } } = await supabase.auth.getUser()
      let redirectPath = accountAuthRedirect(next,false)
      
      if (!user)return NextResponse.redirect(`${origin}/auth/error?error=account_unavailable`)
      if (user) {
        const { data: profile,error:profileError } = await supabase
          .from('profiles')
          .select('org_id')
          .eq('id', user.id)
          .single()
        
        if(profileError||!profile)return NextResponse.redirect(`${origin}/auth/error?error=account_unavailable`)
        // Invitation review remains accessible before organization membership.
        const identity=await supabase.rpc('client_portal_identity')
        if(identity.error)return NextResponse.redirect(`${origin}/auth/error?error=account_unavailable`)
        const isClient=!!identity.data&&typeof identity.data==='object'&&!Array.isArray(identity.data)&&identity.data.kind==='client'
        redirectPath = isClient?clientRedirect(next):accountAuthRedirect(next,!!profile?.org_id)
      }

      const forwardedHost = request.headers.get('x-forwarded-host')
      const isLocalEnv = process.env.NODE_ENV === 'development'
      
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${redirectPath}`)
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${redirectPath}`)
      } else {
        return NextResponse.redirect(`${origin}${redirectPath}`)
      }
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/error?error=auth_callback_error`)
}

