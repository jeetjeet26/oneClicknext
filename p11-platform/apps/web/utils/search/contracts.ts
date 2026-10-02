import {z}from 'zod'
const uuid=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),identity={id:uuid,propertyId:uuid,expectedActorId:uuid},key=z.string().regex(/^(lead|property|material|document|conversation):[a-f0-9-]{36}$/i)
export const searchRead=z.object({propertyId:uuid,kind:z.enum(['history','command','results']).default('history'),id:uuid.optional(),offset:z.coerce.number().int().min(0).max(100000).default(0),hash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict()
export const searchDecision=z.discriminatedUnion('operation',[
z.object({...identity,operation:z.literal('search'),query:z.string().trim().min(2).max(200),filter:z.enum(['all','lead','property','knowledge','conversation'])}).strict(),
z.object({...identity,operation:z.literal('select'),searchId:uuid,key}).strict(),
z.object({...identity,operation:z.literal('navigate'),searchId:uuid,key}).strict(),
z.object({...identity,operation:z.literal('cancel')}).strict(),
])
