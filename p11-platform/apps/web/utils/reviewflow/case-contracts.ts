import {z} from 'zod'
const uuid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),priority=z.enum(['low','medium','high','urgent'])
const common={propertyId:uuid,requestId:uuid,reviewId:uuid,sourceVersion:z.number().int().positive(),reason:z.string().trim().min(3).max(2000)}
const existing={...common,caseId:uuid,expectedVersion:z.number().int().positive()}
const fields={priority:priority.optional(),ownerId:uuid.nullable().optional()}
export const caseDecisionSchema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('create')}).strict(),
 z.object({...existing,action:z.literal('update'),...fields,status:z.enum(['open','triaged','remediation']).optional(),slaDueAt:z.string().datetime({offset:true}).nullable().optional(),remediationState:z.enum(['none','recommended','in_progress','completed']).optional()}).strict(),
 z.object({...existing,action:z.literal('resolve'),resolutionNotes:z.string().trim().min(3).max(4000)}).strict(),
 z.object({...existing,action:z.literal('dismiss'),resolutionNotes:z.string().trim().min(3).max(4000)}).strict(),
 z.object({...existing,action:z.literal('reopen')}).strict(),
 z.object({...existing,action:z.literal('note'),note:z.string().trim().min(3).max(4000)}).strict(),
 z.object({...existing,action:z.literal('ticket.create'),title:z.string().trim().min(3).max(200),description:z.string().max(4000),priority,ownerId:uuid.nullable()}).strict(),
 z.object({...existing,action:z.literal('ticket.update'),ticketId:uuid,expectedTicketVersion:z.number().int().positive(),...fields,status:z.enum(['open','in_progress','resolved','closed']).optional(),title:z.string().trim().min(3).max(200).optional(),description:z.string().max(4000).optional(),resolutionNotes:z.string().trim().max(4000).optional()}).strict(),
 z.object({...existing,action:z.literal('ticket.reopen'),ticketId:uuid,expectedTicketVersion:z.number().int().positive()}).strict(),
])
export type CaseDecision=z.infer<typeof caseDecisionSchema>
export const caseReadSchema=z.object({propertyId:uuid,reviewId:uuid,cursor:uuid.optional()}).strict()
export const ticketReadSchema=z.object({propertyId:uuid,reviewId:uuid.optional(),status:z.enum(['open','in_progress','resolved','closed']).optional(),priority:priority.optional(),assignedTo:uuid.optional(),cursor:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(30)}).strict()
