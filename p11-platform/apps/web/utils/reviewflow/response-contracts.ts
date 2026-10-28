import { decisionNote, requireDecisionNote } from '@/utils/actions/decision-note'
import {z} from 'zod'
export const responseIdSchema=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const uuid=responseIdSchema,hash=z.string().regex(/^[a-f0-9]{64}$/),version=z.number().int().positive(),reason=decisionNote(2000, 3)
const common={propertyId:uuid,requestId:uuid}
const draft={...common,reviewId:uuid,sourceVersion:version,contextHash:hash,responseSetHash:hash,replacePending:z.boolean(),tone:z.enum(['professional','empathetic','friendly','apologetic']),reason}
export const responseWriteSchema=z.discriminatedUnion('action',[
 z.object({...draft,action:z.literal('draft'),responseText:z.string().trim().min(20).max(1400)}).strict(),
 z.object({...draft,action:z.literal('generate')}).strict(),
 z.object({...common,action:z.literal('approve'),responseId:uuid,expectedVersion:version,sourceVersion:version,contextHash:hash,contentHash:hash,reason}).strict(),
 z.object({...common,action:z.literal('reject'),responseId:uuid,expectedVersion:version,sourceVersion:version,contextHash:hash,contentHash:hash,reason}).strict(),
 z.object({...common,action:z.literal('stop_generation'),generationRequestId:uuid,expectedVersion:version,reason}).strict(),
 z.object({...common,action:z.literal('recover_generation'),generationRequestId:uuid,expectedVersion:version,reason}).strict(),
]).superRefine((value, ctx) => { if (value.action === 'reject') requireDecisionNote(value, ctx) })

export const responseReadSchema=z.object({propertyId:uuid,reviewId:uuid,responseCursor:uuid.optional(),generationCursor:uuid.optional()}).strict()
