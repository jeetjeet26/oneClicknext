import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  validatePropertyAccess,
  validatePropertyManagerAccess,
} from '@/utils/services/auth-guard'

export async function authorizeSiteForgeWebsite(
  websiteId: string,
  requireManager = false
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 } as const
  const service = createServiceClient()
  const { data: website } = await service
    .from('property_websites')
    .select('id, org_id, property_id')
    .eq('id', websiteId)
    .maybeSingle()
  if (!website) return { error: 'Website not found', status: 404 } as const
  const access = requireManager
    ? await validatePropertyManagerAccess(user.id, website.property_id)
    : await validatePropertyAccess(user.id, website.property_id)
  if (!access.authorized) return { error: 'Forbidden', status: 403 } as const
  return { user, website, service } as const
}

export async function authorizeSiteForgeIncident(
  incidentId: string,
  requireManager = false
) {
  const service = createServiceClient()
  const { data: incident } = await service
    .from('siteforge_incidents')
    .select('id, website_id')
    .eq('id', incidentId)
    .maybeSingle()
  if (!incident) return { error: 'Incident not found', status: 404 } as const
  const auth = await authorizeSiteForgeWebsite(
    incident.website_id,
    requireManager
  )
  if ('error' in auth) return auth
  return { ...auth, incident } as const
}
