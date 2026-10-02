import {z} from 'zod'
import {responseIdSchema as uuid} from './response-contracts'
const reason=z.string().trim().min(3).max(1000)
export const testimonialReadSchema=z.object({propertyId:uuid,cursor:uuid.optional()}).strict()
const base={propertyId:uuid,requestId:uuid,reason}
export const testimonialDecisionSchema=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('approve'),sourceVersion:z.number().int().positive(),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),attributionApproved:z.literal(true),rightsBasis:z.enum(['platform_terms','direct_consent','property_license','other']),evidenceNote:reason,usageScope:z.array(z.enum(['website','social'])).min(1).max(2).refine(v=>new Set(v).size===v.length),expiresAt:z.string().datetime({offset:true}).nullable()}).strict(),
 z.object({...base,action:z.literal('revoke'),approvalId:uuid,expectedVersion:z.number().int().positive()}).strict()
])
