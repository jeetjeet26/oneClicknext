import { z } from 'zod'
import { marketId } from './decision-contracts'
const reason = z.string().trim().min(3).max(2000)
const version = z.number().int().positive()
export const sourceRead = z.object({ propertyId: marketId, competitorId: marketId, requestId: marketId.optional(), cursor: marketId.optional() }).strict()
export const sourceRequest = z.object({ requestId: marketId, propertyId: marketId, competitorId: marketId, expectedVersion: version, source: z.enum(['website', 'apartments_com']), reason }).strict()
export const sourceControl = z.object({ requestId: marketId, propertyId: marketId, sourceId: marketId, expectedVersion: version, action: z.enum(['stop', 'recover']), reason }).strict()
export const capturedExtraction = z.object({ requestId: marketId, propertyId: marketId, competitorId: marketId, sourceId: marketId, expectedVersion: version, confirmedScope: z.literal(true), reason }).strict()
