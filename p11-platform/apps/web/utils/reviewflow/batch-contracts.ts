import {z} from 'zod'
import {responseIdSchema as uuid} from './response-contracts'
const common={propertyId:uuid,requestId:uuid,reason:z.string().trim().min(3).max(2000)}
export const batchWriteSchema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('prepare'),scope:z.literal('unanalyzed_current')}).strict(),
 z.object({...common,action:z.literal('approve'),batchId:uuid,expectedVersion:z.number().int().positive(),maxModelCalls:z.number().int().min(1).max(1000000)}).strict(),
 z.object({...common,action:z.enum(['stop','recover']),batchId:uuid,expectedVersion:z.number().int().positive()}).strict(),
])
export const batchReadSchema=z.object({propertyId:uuid,batchId:uuid.optional(),cursor:uuid.optional(),afterPosition:z.coerce.number().int().min(0).default(0)}).strict()
export const batchStates=['saved','replayed','prepared','queued','running','needs_review','completed','stopped','busy','linked','analyzed','staff_review','held','reused','authority_required']
