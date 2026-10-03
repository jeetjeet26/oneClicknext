import { z } from 'zod'
import { marketId, publicMarketUrl } from './decision-contracts'

export function isMarketListing(value: string) {
  if (!publicMarketUrl(value) || !/^https?:\/\/(www\.)?apartments\.com\/[a-z0-9][^\s\\]*$/i.test(value)) return false
  const url = new URL(value)
  return ['apartments.com', 'www.apartments.com'].includes(url.hostname) && /^\/[a-z0-9]/i.test(url.pathname)
}
const common = {
  requestId: marketId,
  propertyId: marketId,
  competitorId: marketId,
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(2000),
}
export const listingDecision = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('save'), url: z.string().trim().max(2000).refine(isMarketListing, 'Use the complete Apartments.com listing URL') }).strict(),
  z.object({ ...common, action: z.literal('remove') }).strict(),
])
export const listingRead = z.object({ propertyId: marketId, competitorId: marketId }).strict()
