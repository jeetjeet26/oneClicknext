import { describe, expect, it } from 'vitest'
import {
  getMarketingChannelFilterValues,
  getMarketingChannelLabel,
  normalizeMarketingChannelId,
  normalizeMarketingChannels,
} from './channel-identity'

describe('channel identity normalization', () => {
  it('normalizes legacy aliases to canonical channel ids', () => {
    expect(normalizeMarketingChannelId('meta')).toBe('meta_ads')
    expect(normalizeMarketingChannelId('google')).toBe('google_ads')
    expect(normalizeMarketingChannelId(' META_ADS ')).toBe('meta_ads')
  })

  it('dedupes and removes unknown channel values', () => {
    expect(normalizeMarketingChannels(['meta', 'meta_ads', 'google_ads', ''])).toEqual([
      'meta_ads',
      'google_ads',
    ])
  })

  it('returns compatibility filter values for canonical channels', () => {
    expect(getMarketingChannelFilterValues(['meta_ads'])).toEqual(['meta_ads', 'meta'])
    expect(getMarketingChannelFilterValues(['google_ads'])).toEqual(['google_ads', 'google'])
  })

  it('formats canonical labels consistently', () => {
    expect(getMarketingChannelLabel('meta')).toBe('Meta Ads')
    expect(getMarketingChannelLabel('meta_ads')).toBe('Meta Ads')
    expect(getMarketingChannelLabel('google_ads')).toBe('Google Ads')
  })
})
