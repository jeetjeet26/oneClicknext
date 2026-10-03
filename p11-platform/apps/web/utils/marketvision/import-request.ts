import { normalizeMarketingChannels } from '@/utils/analytics/channel-identity'

export const IMPORT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RANGES = ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH']
export type MarketingImportRequest = { property_id: string; job_id: string; channels: string[]; date_range: string }

export function parseImportRequest(value: unknown): Omit<MarketingImportRequest, 'job_id'> & { job_id?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('An import request is required.')
  const body = value as Record<string, unknown>
  if (typeof body.property_id !== 'string' || !IMPORT_UUID.test(body.property_id)) throw new Error('A valid property_id is required.')
  if (body.job_id !== undefined && (typeof body.job_id !== 'string' || !IMPORT_UUID.test(body.job_id))) throw new Error('A valid job_id is required.')
  const inputChannels = body.channels === undefined ? ['google_ads', 'meta_ads'] : body.channels
  if (!Array.isArray(inputChannels) || !inputChannels.length || inputChannels.length > 10 || inputChannels.some(channel => typeof channel !== 'string')) {
    throw new Error('Choose at least one supported ad channel.')
  }
  const channels = normalizeMarketingChannels(inputChannels)
  if (!channels.length || channels.some(channel => !['google_ads', 'meta_ads'].includes(channel))) throw new Error('Only Google Ads and Meta Ads imports are supported.')
  const range = body.date_range === undefined ? 'LAST_7_DAYS' : body.date_range
  if (typeof range !== 'string' || !RANGES.includes(range)) throw new Error('Choose a supported date range.')
  return { property_id: body.property_id, job_id: body.job_id as string | undefined, channels: channels.sort(), date_range: range }
}
