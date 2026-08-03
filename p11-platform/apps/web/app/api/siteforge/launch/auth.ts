import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'

export async function requireLaunchManager(propertyId: string) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    return {
      user: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  const access = await validatePropertyManagerAccess(user.id, propertyId)
  if (!access.authorized) {
    return {
      user: null,
      response: NextResponse.json(
        { error: 'SiteForge launch manager permission required' },
        { status: 403 }
      ),
    }
  }
  return { user, response: null }
}
