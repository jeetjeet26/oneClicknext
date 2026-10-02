import {z} from 'zod'
export const activityId=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)
const common={requestId:activityId,propertyId:activityId,reason:z.string().trim().min(3).max(2000)},review={noteId:activityId,expectedVersion:z.number().int().min(0),sourceHash:z.string().regex(/^[a-f0-9]{64}$/)}
export const NoteDecision=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('add'),content:z.string().trim().min(1).max(16000)}).strict(),
 z.object({...common,...review,action:z.literal('correct'),content:z.string().trim().min(1).max(16000)}).strict(),
 z.object({...common,...review,action:z.literal('withdraw')}).strict(),
 z.object({...common,...review,action:z.literal('restore')}).strict(),
])
export const ActivityRead=z.object({propertyId:activityId,cursor:activityId.optional(),noteId:activityId.optional()}).strict()
