import { crmResponse, savedCRMRequest } from './client'

export async function prepareLeadBatch(propertyId: string, leadIds: string[]): Promise<string> {
  const request = await savedCRMRequest('bulk-prepare', { action: 'prepare', propertyId, leadIds: [...leadIds].sort() })
  const result = await crmResponse(await fetch('/api/crm/batches', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body),
  }))
  if (typeof result.batchId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(result.batchId)) {
    throw new Error('The saved CRM review could not be confirmed. Check saved CRM transfers before retrying.')
  }
  request.acknowledge()
  return '/dashboard/settings/crm?' + new URLSearchParams({ propertyId, batchId: result.batchId })
}
