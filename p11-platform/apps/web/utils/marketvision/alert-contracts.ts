import {z} from 'zod'
import {marketId} from './decision-contracts'
const reason=z.string().trim().min(3).max(2000)
export const AlertRead=z.object({propertyId:marketId,view:z.enum(['open','unread','dismissed','all']).default('open'),cursor:marketId.optional(),limit:z.coerce.number().int().min(1).max(50).default(20)}).strict()
export const AlertCreate=z.object({propertyId:marketId,requestId:marketId,title:z.string().trim().min(1).max(300),description:z.string().trim().max(4000).nullable(),severity:z.enum(['info','warning','critical']),competitorId:marketId.nullable(),reason}).strict()
export const AlertReview=z.object({propertyId:marketId,requestId:marketId,action:z.enum(['read','dismiss','restore']),alerts:z.array(z.object({id:marketId,expectedVersion:z.number().int().positive()}).strict()).min(1).max(50).refine(a=>new Set(a.map(x=>x.id)).size===a.length),reason}).strict()
export const AlertRecord=z.object({id:marketId,version:z.number().int().positive(),competitorId:marketId.nullable(),competitorName:z.string().nullable(),alertType:z.string(),severity:z.string(),title:z.string(),description:z.string().nullable(),isRead:z.boolean(),isDismissed:z.boolean(),readAt:z.string().nullable(),createdAt:z.string().nullable(),source:z.enum(['operator_reported','historical_unverified'])})
export const AlertPage=z.object({state:z.literal('ready'),alerts:z.array(AlertRecord).max(50),nextCursor:marketId.nullable(),counts:z.object({all:z.number().int().nonnegative(),open:z.number().int().nonnegative(),unread:z.number().int().nonnegative(),dismissed:z.number().int().nonnegative()}),readAt:z.string()})
export type SavedMarketAlert=z.infer<typeof AlertRecord>
export type MarketAlertPage=z.infer<typeof AlertPage>
