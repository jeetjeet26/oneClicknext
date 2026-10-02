import {z} from 'zod'
import {marketId} from './decision-contracts'
const reason=z.string().trim().min(3).max(2000),version=z.number().int().positive(),hash=z.string().regex(/^[a-f0-9]{64}$/)
export const brandCategories=['positioning','audience','voice','amenity','service','promotion','lifestyle','messaging','call_to_action']as const
export const BrandClaim=z.object({category:z.enum(brandCategories),kind:z.enum(['source_claim','interpretation']),statement:z.string().min(1).max(1000).refine(s=>s.trim().length>0),quote:z.string().min(1).max(1000)}).strict()
export const BrandOutput=z.object({claims:z.array(BrandClaim).max(50),notes:z.string().max(5000).nullable()}).strict()
export type BrandPreview=z.infer<typeof BrandOutput>
export function validateBrandPreview(content:string,value:unknown){const parsed=BrandOutput.parse(value);for(const c of parsed.claims)if(!content.includes(c.quote))throw new Error('A quotation is absent from the retained page.');return parsed}
export const BrandRequest=z.object({requestId:marketId,propertyId:marketId,competitorId:marketId,sourceId:marketId,sourceVersion:version,confirmedSourceScope:z.literal(true),reason}).strict()
export const BrandRead=z.object({propertyId:marketId,competitorId:marketId.optional(),requestId:marketId.optional(),cursor:marketId.optional(),view:z.enum(['current','requests','reviews','legacy']).default('current')}).strict().refine(v=>!v.requestId||(!v.cursor&&!!v.competitorId))
export const BrandControl=z.object({requestId:marketId,propertyId:marketId,brandRequestId:marketId,expectedVersion:version,action:z.enum(['stop','recover']),reason}).strict()
const selected=z.discriminatedUnion('action',[z.object({sourceIndex:z.number().int().min(0).max(49),action:z.literal('skip')}).strict(),z.object({sourceIndex:z.number().int().min(0).max(49),action:z.literal('include'),claim:BrandClaim}).strict()])
const common={requestId:marketId,propertyId:marketId,brandRequestId:marketId,expectedVersion:version,expectedReviewId:marketId.nullable(),reason}
export const BrandReview=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('publish'),previewHash:hash,acknowledgeInterpretation:z.literal(true),acknowledgeReplacement:z.literal(true),selection:z.array(selected).max(50).refine(rows=>new Set(rows.map(r=>r.sourceIndex)).size===rows.length)}).strict(),
 z.object({...common,action:z.literal('withdraw')}).strict()
])
