import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
const hash=z.string().regex(/^[a-f0-9]{64}$/),identity={id,propertyId:id,expectedActorId:id}
export const recommendationDecision=z.discriminatedUnion('operation',[
 z.object({...identity,operation:z.literal('prepare'),batchId:id,crawlId:id,sourceHash:hash,modelHash:hash,parentId:id.optional()}).strict(),
 z.object({...identity,operation:z.enum(['cancel','cancel_decision'])}).strict(),
 z.object({...identity,operation:z.enum(['apply','discard','stop','resume']),analysisId:id,previewHash:hash.nullable(),reason:z.string().trim().min(1).max(2000).refine(s=>!s.includes('\u0000'))}).strict()
])
export const recommendationRead=z.object({propertyId:id,id:id.optional(),batchId:id.optional(),crawlId:id.optional(),kind:z.enum(['history','sources']).default('history'),offset:z.coerce.number().int().min(0).max(1000000).default(0),hash:hash.optional(),commandId:id.optional()}).strict()
export const pendingRecommendation=z.object({id,kind:z.enum(['prepare','decision'])}).strict()
