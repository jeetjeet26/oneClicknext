import {z} from 'zod'
const uuid=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),hash=z.string().regex(/^[a-f0-9]{64}$/),identity={id:uuid,propertyId:uuid,expectedActorId:uuid},source={conversationId:uuid,sourceHash:hash},reason=z.string().trim().min(1).max(2000)
export const conversationRead=z.object({propertyId:uuid,conversationId:uuid.optional(),kind:z.enum(['list','messages','history','command','service']).default('list'),commandId:uuid.optional(),offset:z.coerce.number().int().min(0).max(100000).default(0),hash:hash.optional(),archived:z.enum(['true','false']).default('false'),leadId:uuid.optional()}).strict()
export const conversationDecision=z.discriminatedUnion('operation',[
 z.object({...identity,...source,operation:z.literal('takeover'),reason}).strict(),
 z.object({...identity,...source,operation:z.literal('release'),reason}).strict(),
 z.object({...identity,...source,operation:z.literal('archive'),reason}).strict(),
 z.object({...identity,...source,operation:z.literal('restore'),reason}).strict(),
 z.object({...identity,...source,operation:z.literal('reply'),content:z.string().trim().min(1).max(10000)}).strict(),
 z.object({...identity,...source,operation:z.literal('review')}).strict(),
 z.object({...identity,operation:z.literal('export'),conversationId:uuid,reviewId:uuid}).strict(),
 z.object({...identity,operation:z.literal('report'),preparationId:uuid,artifactHash:hash,outcome:z.enum(['download_initiated','failed'])}).strict(),
 z.object({...identity,operation:z.literal('cancel')}).strict(),
])
