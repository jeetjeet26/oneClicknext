import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
const hash=z.string().regex(/^[a-f0-9]{64}$/), identity={id,propertyId:id,expectedActorId:id}
export const evaluationDecision=z.discriminatedUnion('operation',[
 z.object({...identity,operation:z.literal('prepare'),runId:id,sourceHash:hash}).strict(),
 z.object({...identity,operation:z.literal('resume')}).strict(),
 z.object({...identity,operation:z.enum(['cancel','cancel_decision'])}).strict(),
 z.object({...identity,operation:z.enum(['apply','discard']),evaluationId:id,previewHash:hash.nullable(),reason:z.string().trim().min(1).max(2000).refine(s=>!s.includes('\u0000'))}).strict()
])
export const evaluationRead=z.object({propertyId:id,id:id.optional(),runId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),hash:hash.optional(),commandId:id.optional()}).strict()
export const pendingEvaluation=z.object({id,kind:z.enum(['prepare','decision'])}).strict()
