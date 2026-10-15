import 'server-only'
import { brainRpc, resolveCommunityScope } from './server'
import type { SavedCommunityContext, ServiceDeliverable } from './generation'

export async function brandCommunityContext(actorId: string, propertyId: string, operationId: string, prepare = false, deliverableId?: string) {
  const scope = await resolveCommunityScope(actorId, propertyId, 'brand')
  return brainRpc<SavedCommunityContext & {servicePackage?:ServiceDeliverable}>('brain_brand_context', {
    p_scope_id: scope.id,
    p_operation_id: operationId,
    p_prepare: prepare,
    p_deliverable_id: deliverableId ?? null,
  })
}
