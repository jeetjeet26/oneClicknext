import { publicMarketUrl } from './decision-contracts'

export interface AdvertisedSalePrice {
  amount: number
  quote: string
  sourceUrl: string
  fetchedAt: string
}

export function advertisedSalePrice(capture: {
  text: string
  sourceUrl: string
  fetchedAt: string
}): AdvertisedSalePrice | null {
  if (!publicMarketUrl(capture.sourceUrl) || !Number.isFinite(Date.parse(capture.fetchedAt))) return null
  const opening = capture.text.slice(0, 9000).split(/\b(?:nearby communities|you might also like|similar communities)\b/i)[0]
  const price = /^\s*(?:(?:new release|now selling)\s+)?(?:starting (?:at|from)|priced from|from)\s+\$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)(?:\s*\*)?\s*$/i
  for (const line of opening.split('\n')) {
    const match = price.exec(line)
    if (!match) continue
    const amount = Number(match[1].replaceAll(',', ''))
    if (amount >= 10_000 && amount <= 100_000_000) {
      return {amount, quote: line.trim(), sourceUrl: capture.sourceUrl, fetchedAt: capture.fetchedAt}
    }
  }
  return null
}
