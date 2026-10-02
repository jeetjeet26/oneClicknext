import {z} from 'zod'
import {marketId} from './decision-contracts'
import {brandCategories} from './brand-evidence-contracts'
export const SearchRequest=z.object({requestId:marketId,propertyId:marketId,query:z.string().trim().min(2).max(200),mode:z.enum(['phrase','all','any']),category:z.enum(['all',...brandCategories]),kind:z.enum(['all','source_claim','interpretation']),competitorId:marketId.nullable()}).strict().refine(v=>v.mode==='phrase'||v.query.split(/\s+/).length<=10)
export const SearchRead=z.object({propertyId:marketId,requestId:marketId.optional(),cursor:marketId.optional(),after:z.coerce.number().int().min(0).max(10000).multipleOf(20).default(0)}).strict().refine(v=>v.requestId?!v.cursor:v.after===0)
