import { randomUUID } from 'node:crypto'
import { createServiceClient } from '@/utils/supabase/admin'
import { getDataEngineUrl } from '@/utils/services/runtime-config'

export type QueuedAdImport = { synced: number; accepted?: boolean; jobId?: string; error?: string; retryable?: boolean }
export async function queueAdConnection(platform: 'google_ads' | 'meta_ads', connectionId: string, accountId: string, propertyId: string, daysBack = 7): Promise<QueuedAdImport> {
  const periods: Record<number, string> = { 1: 'YESTERDAY', 7: 'LAST_7_DAYS', 14: 'LAST_14_DAYS', 30: 'LAST_30_DAYS' }
  const dateRange = periods[daysBack]
  if (!dateRange) return { synced: 0, error: 'Choose 1, 7, 14 or 30 days.', retryable: false }
  if (!process.env.DATA_ENGINE_API_KEY) return { synced: 0, error: 'The import service is not configured.', retryable: false }
  const client = createServiceClient()
  const { data: connection, error } = await client.from('ad_account_connections').select('id').eq('id', connectionId).eq('property_id', propertyId).eq('platform', platform).eq('account_id', accountId).eq('is_active', true).maybeSingle()
  if (error || !connection) return { synced: 0, error: 'This active account could not be confirmed for the property.', retryable: false }
  const jobId = randomUUID()
  const uncertain = () => ({ synced: 0, jobId, error: 'Import acceptance could not be confirmed. Review this job before retrying.', retryable: false })
  try {
    const response = await fetch(`${getDataEngineUrl()}/sync-marketing-data`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DATA_ENGINE_API_KEY}` },
      body: JSON.stringify({ job_id: jobId, property_id: propertyId, channels: [platform], connection_ids: [connectionId], date_range: dateRange }), signal: AbortSignal.timeout(20_000),
    })
    const body = await response.json()
    if (!response.ok || body.status !== 'accepted' || body.job_id !== jobId || body.property_id !== propertyId) return uncertain()
    const { data: job, error: readError } = await client.from('import_jobs').select('id,property_id,channels,connection_ids,date_range,recovery_version').eq('id', jobId).eq('property_id', propertyId).maybeSingle()
    if (readError || job?.recovery_version !== 1 || job.date_range !== dateRange || job.channels?.length !== 1 || job.channels[0] !== platform || job.connection_ids?.length !== 1 || job.connection_ids[0] !== connectionId) return uncertain()
    return { synced: 0, accepted: true, jobId }
  } catch { return uncertain() }
}
