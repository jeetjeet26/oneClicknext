export const MARKETING_CHANNEL_ALIASES: Record<string, string> = {
  google: 'google_ads',
  googleads: 'google_ads',
  google_ads: 'google_ads',
  meta: 'meta_ads',
  facebook_ads: 'meta_ads',
  instagram_ads: 'meta_ads',
  meta_ads: 'meta_ads',
  tiktok: 'tiktok_ads',
  tiktok_ads: 'tiktok_ads',
  linkedin: 'linkedin_ads',
  linkedin_ads: 'linkedin_ads',
  microsoft_ads: 'bing_ads',
  bing: 'bing_ads',
  bing_ads: 'bing_ads',
  ga4: 'ga4',
}

export function normalizeMarketingChannelId(channel: string | null | undefined): string {
  const normalized = (channel || '').trim().toLowerCase()
  if (!normalized) {
    return 'unknown'
  }
  return MARKETING_CHANNEL_ALIASES[normalized] || normalized
}

export function normalizeMarketingChannels(channels: readonly string[] | null | undefined): string[] {
  const values = Array.isArray(channels) ? channels : []
  const deduped = new Set<string>()
  for (const channel of values) {
    deduped.add(normalizeMarketingChannelId(channel))
  }
  deduped.delete('unknown')
  return Array.from(deduped)
}

export function getMarketingChannelFilterValues(
  channels: readonly string[] | null | undefined
): string[] {
  const normalized = normalizeMarketingChannels(channels)
  const values = new Set<string>(normalized)

  for (const channel of normalized) {
    if (channel === 'meta_ads') {
      values.add('meta')
    }
    if (channel === 'google_ads') {
      values.add('google')
    }
  }

  return Array.from(values)
}

export function getMarketingChannelLabel(channel: string | null | undefined): string {
  const normalized = normalizeMarketingChannelId(channel)
  const labels: Record<string, string> = {
    google_ads: 'Google Ads',
    meta_ads: 'Meta Ads',
    ga4: 'Google Analytics',
    tiktok_ads: 'TikTok Ads',
    linkedin_ads: 'LinkedIn Ads',
    bing_ads: 'Bing Ads',
    unknown: 'Unknown',
  }
  return labels[normalized] || normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}
