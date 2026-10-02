import {z} from 'zod'
import {responseIdSchema as uuid} from './response-contracts'
const common={propertyId:uuid,requestId:uuid,reason:z.string().trim().min(3).max(2000)}
export const intakeWriteSchema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('save'),kind:z.enum(['manual','csv']),content:z.string().min(1).max(2_000_000),fileName:z.string().max(300).optional()}).strict(),
 z.object({...common,action:z.literal('fetch'),connectionId:uuid,connectionVersion:z.number().int().positive()}).strict(),
 z.object({...common,action:z.enum(['apply','stop','recover','rebase']),intakeId:uuid,expectedVersion:z.number().int().positive()}).strict(),
])
export const intakeReadSchema=z.object({propertyId:uuid,intakeId:uuid.optional(),cursor:uuid.optional(),offset:z.coerce.number().int().min(0).max(500).default(0)}).strict()
export const intakeStates=['saved','replayed','queued','running','result_ready','preview','completed','held','stopped','busy']
