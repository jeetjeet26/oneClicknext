import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validateSiteForgeOwnerOperatorAccess } from '@/utils/services/auth-guard'
import {
  assertActiveAuroraLifecycleLease,
  AuroraLifecycleControlError,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'

export async function requireLaunchManager(
  propertyId: string,
  lifecycleRequest?: Request
) {
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
  const access = await validateSiteForgeOwnerOperatorAccess(user.id, propertyId)
  if (!access.authorized) {
    return {
      user: null,
      response: NextResponse.json(
        {
          error: 'SiteForge owner/operator capability required',
          capability: access.capability,
        },
        { status: 403 }
      ),
    }
  }
  if (lifecycleRequest) {
    try {
      await assertActiveAuroraLifecycleLease(lifecycleRequest, { propertyId })
    } catch (error) {
      if (error instanceof AuroraLifecycleControlError) {
        return {
          user: null,
          response: NextResponse.json(
            { error: error.message, code: error.code },
            { status: error.statusCode }
          ),
        }
      }
      throw error
    }
  }
  return { user, response: null }
}
