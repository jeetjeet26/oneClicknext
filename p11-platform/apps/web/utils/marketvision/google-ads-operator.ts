import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { isPlatformOperator } from '@/utils/services/platform-operator'

export const GOOGLE_ADS_STATE_COOKIE = 'p11_google_ads_oauth'
export const GOOGLE_ADS_STATE_MAX_AGE = 600

export async function googleAdsOperator() {
  const auth = await createClient()
  const { data: { user }, error } = await auth.auth.getUser()
  if (error || !user) return null
  const db = createServiceClient()
  const { data: profile } = await db.from('profiles').select('org_id, role').eq('id', user.id).single()
  if (!profile?.org_id || !isPlatformOperator(user.id, profile.role)) return null
  return { db, orgId: profile.org_id, actorId: user.id }
}
