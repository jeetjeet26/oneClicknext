import { normalizeMarketingChannelId } from './channel-identity'

export const MARKETING_FACT_CONFLICT = 'date,property_id,channel_id,source_account_id,campaign_id'

export function factAccountId(channel: string, value: unknown): string {
  if (typeof value !== 'string') throw new Error('The source account ID is required')
  const platform = normalizeMarketingChannelId(channel)
  const id = value.trim().replace(platform === 'google_ads' ? /-/g : /^act_/, '')
  if (!/^[0-9]+$/.test(id) || (platform === 'google_ads' && id.length !== 10)) {
    throw new Error('Enter the provider account ID for this export')
  }
  return id
}

export function conversionValue(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new Error('Conversion values must be valid numbers')
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number >= 1e15) throw new Error('Conversion value is outside reporting limits')
  return number
}

export function requireUSD(value: unknown): 'USD' {
  if (value !== 'USD') throw new Error('Confirm the export uses US dollars; other currencies are not supported yet')
  return 'USD'
}

export function campaignIdentity(channel: string | null, account: string | null, campaign: string): string {
  return JSON.stringify([normalizeMarketingChannelId(channel), account, campaign])
}

export function formatConversions(value: number): string {
  return value.toLocaleString('en-US', { maximumSignificantDigits: 15 })
}
