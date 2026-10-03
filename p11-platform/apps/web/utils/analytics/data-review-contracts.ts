import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
const hash=z.string().regex(/^[a-f0-9]{64}$/)
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v)
const identity={id,propertyId:id,expectedActorId:id}
export const dataReviewDecision=z.discriminatedUnion('operation',[
 z.object({...identity,operation:z.literal('save'),startDate:date,endDate:date,sourceHash:hash}).strict(),
 z.object({...identity,operation:z.enum(['exclude','restore']),reviewId:id,rowId:id,kind:z.enum(['daily','dimension']),reason:z.string().trim().min(1).max(2000).refine(v=>!v.includes('\u0000'))}).strict(),
 z.object({...identity,operation:z.literal('export'),reviewId:id}).strict(),
 z.object({...identity,operation:z.literal('report'),reviewId:id,exportId:id,artifactHash:hash,outcome:z.enum(['initiated','failed'])}).strict(),
 z.object({...identity,operation:z.literal('cancel')}).strict()
])
export const dataReviewRead=z.object({propertyId:id,startDate:date.optional(),endDate:date.optional(),reviewId:id.optional(),commandId:id.optional(),kind:z.enum(['current','history','decisions','rows']).default('current'),offset:z.coerce.number().int().min(0).max(1000000).default(0),hash:hash.optional()}).strict()
export type DataReviewRow={kind:'daily'|'dimension';id:string;source:Record<string,unknown>;excluded:boolean;decisionId:string|null;reasons:string[];rowHash:string}
export type DataReviewPage={state:'ready';actorId:string;propertyId:string;canManage:boolean;kind:string;reviewId:string|null;items:DataReviewRow[];count:number;offset:number;hash:string;complete:true;startDate:string;endDate:string}
