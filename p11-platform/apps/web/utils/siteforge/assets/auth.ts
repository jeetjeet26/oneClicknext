import { createClient } from '@/utils/supabase/server'
import {
  validatePropertyAccess,
  validatePropertyManagerAccess,
} from '@/utils/services/auth-guard'

export type AssetAuthorization =
  | { status: 401; userId: null; orgId: null }
  | { status: 403; userId: string; orgId: null }
  | { status: 200; userId: string; orgId: string }

export async function authorizeAssetProperty(
  propertyId: string,
  options?: { manager?: boolean }
): Promise<AssetAuthorization> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    return { status: 401, userId: null, orgId: null }
  }
  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized || !access.orgId) {
    return { status: 403, userId: user.id, orgId: null }
  }
  if (options?.manager) {
    const managerAccess = await validatePropertyManagerAccess(user.id, propertyId)
    if (!managerAccess.authorized) {
      return { status: 403, userId: user.id, orgId: null }
    }
  }
  return { status: 200, userId: user.id, orgId: access.orgId }
}
