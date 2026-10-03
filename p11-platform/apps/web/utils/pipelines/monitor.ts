import { deriveImportJobState } from '@/utils/marketvision/import-job-state'
import type { Tables } from '@/types/supabase'

export type PipelineConnection = Pick<Tables<'ad_account_connections'>,
  'id' | 'platform' | 'account_name' | 'is_active' | 'last_synced_at' | 'last_error' | 'error_count'>
export type PipelineImport = Pick<Tables<'import_jobs'>,
  'id' | 'channels' | 'status' | 'progress_pct' | 'current_step' | 'records_imported' |
  'error_message' | 'started_at' | 'completed_at' | 'created_at'>
export type PipelineSnapshot = {
  property_id: string
  connections: PipelineConnection[]
  runs: PipelineImport[]
  checked_at: string
  history_limit: number
}
export type PipelineState = 'pending' | 'running' | 'complete' | 'partial' | 'failed' | 'unknown'

export function pipelineState(run: Pick<PipelineImport, 'status' | 'error_message'>): PipelineState {
  return deriveImportJobState(run)
}

export function channelName(channel: string): string {
  return ({ google_ads: 'Google Ads', meta_ads: 'Meta Ads', ga4: 'Google Analytics 4' })[channel] || channel
}

export function connectionState(connection: PipelineConnection): string {
  if (connection.is_active === false) return 'Inactive'
  if (connection.is_active !== true) return 'Activation unknown'
  if (connection.last_error || (connection.error_count ?? 0) > 0) return 'Needs attention'
  if (connection.last_synced_at) return 'Sync recorded'
  return 'No sync recorded'
}

export function importNeedsReview(run: PipelineImport, now: number): boolean {
  const state = pipelineState(run)
  const start = Date.parse(run.started_at || run.created_at || '')
  return (state === 'running' || state === 'pending') && Number.isFinite(start) && now - start > 30 * 60 * 1000
}
