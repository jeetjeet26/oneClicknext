import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
const hash=z.string().regex(/^[a-f0-9]{64}$/),text=(n:number)=>z.string().trim().min(1).max(n).refine(v=>!v.includes('\u0000')),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const csvOriginal=z.object({filename:text(250),csvContent:z.string().min(1).max(8*1024*1024).refine(v=>!v.includes('\u0000')),platform:z.enum(['google_ads','meta_ads']),sourceAccountId:text(40),campaignName:text(250),campaignId:text(150).optional(),currencyCode:z.literal('USD'),startDate:date.optional(),endDate:date.optional()}).strict()
const identity={id,propertyId:id,expectedActorId:id}
export const csvDecision=z.discriminatedUnion('operation',[
 z.object({...identity,operation:z.literal('prepare'),original:csvOriginal,parentId:id.optional()}).strict(),
 z.object({...identity,operation:z.enum(['cancel_preview','cancel_decision'])}).strict(),
 z.object({...identity,operation:z.enum(['apply','discard']),importId:id,previewHash:hash,targetHash:hash,reason:text(2000)}).strict()
])
export const csvRead=z.object({propertyId:id,id:id.optional(),commandId:id.optional(),kind:z.enum(['history','rows','before','after','decisions','legacy']).default('history'),offset:z.coerce.number().int().min(0).max(1000000).default(0),hash:hash.optional()}).strict()
export const csvPending=z.object({id,kind:z.enum(['preview','decision'])}).strict()
