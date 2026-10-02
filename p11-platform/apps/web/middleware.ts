import {clientApiAllowed,clientPageAllowed} from '@/utils/client-portal/routing'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/supabase'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // If env vars are missing, don't hard-crash the entire app in middleware.
  // This commonly happens in local dev when env files aren't being loaded into the Edge runtime.
  if (!supabaseUrl || !supabasePublishableKey) {
    console.error(
      [
        '[middleware] Missing Supabase env vars.',
        'Required: NEXT_PUBLIC_SUPABASE_URL and either NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.',
        'Fix: ensure they exist in p11-platform/.env (shared) OR apps/web/.env.local, then restart `npm run dev`.',
      ].join(' ')
    )

    return supabaseResponse
  }

  const supabase = createServerClient<Database>(
    supabaseUrl,
    supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Define public routes that don't require authentication
  const publicRoutes = ['/auth/login', '/auth/signup', '/auth/callback', '/auth/forgot-password', '/auth/reset-password', '/auth/error', '/.well-known']
  const isPublicRoute = publicRoutes.some(route => 
    request.nextUrl.pathname.startsWith(route)
  )
  
  const path=request.nextUrl.pathname
  const isApi=path.startsWith('/api/')
  if(user){
    const identity=await supabase.rpc('client_portal_identity')
    if(identity.error)return NextResponse.json({error:'Account access is temporarily unavailable. Please try again.'},{status:503,headers:{'Cache-Control':'private, no-store'}})
    const isClient=!!identity.data&&typeof identity.data==='object'&&!Array.isArray(identity.data)&&identity.data.kind==='client'
    if(isClient){
      if(isApi)return clientApiAllowed(path,request.method)?supabaseResponse:NextResponse.json({error:'This client account has read-only access to its assigned properties.'},{status:403,headers:{'Cache-Control':'private, no-store'}})
      if(!clientPageAllowed(path)||path==='/auth/login'&&request.nextUrl.searchParams.get('reauth')!=='1'||path==='/auth/signup'){
        const url=request.nextUrl.clone();url.pathname='/client';url.search='';return NextResponse.redirect(url)
      }
      return supabaseResponse
    }
  }
  // Existing public widgets, callbacks and workers keep their own API authorization.
  if(isApi)return supabaseResponse

  // Invitation review exchanges its fragment for a private cookie before sign-in.
  if (['/join/team','/join/client'].includes(request.nextUrl.pathname)) return supabaseResponse

  // Onboarding is a special route - requires auth but no org
  const isOnboardingRoute = request.nextUrl.pathname.startsWith('/onboarding')

  // Redirect to login if user is not authenticated and trying to access protected route
  if (!user && !isPublicRoute && !isOnboardingRoute && request.nextUrl.pathname !== '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  // If user is authenticated but trying to access onboarding without auth, redirect to login
  if (!user && isOnboardingRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // For authenticated users, check if they need onboarding
  if (user && !isPublicRoute && !isOnboardingRoute && request.nextUrl.pathname !== '/account/security') {
    // Check if user has an org_id in their profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()

    // If no org, redirect to onboarding (unless already there)
    if (!profile?.org_id) {
      const url = request.nextUrl.clone()
      url.pathname = '/onboarding'
      return NextResponse.redirect(url)
    }
  }

  // First-time setup retains its own authenticated completion receipt and recovery.
  // Existing members are read-only in that route; native setup commands reject a second org.

  // Redirect to dashboard if user is authenticated and trying to access auth pages
  if (user && isPublicRoute && ['/auth/login','/auth/signup'].includes(request.nextUrl.pathname) && !(request.nextUrl.pathname === '/auth/login' && request.nextUrl.searchParams.get('reauth') === '1')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Redirect root to dashboard if authenticated, otherwise to login
  if (request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = user ? '/dashboard' : '/auth/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, js for widgets, etc)
     * API handlers retain their authorization; client identities also receive an outer read-only fence.
     * - lumaleasing.js (public widget script)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js)$|lumaleasing).*)',
  ],
}

