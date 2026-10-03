import {z} from 'zod'
import {PROPERTY_TYPE_VALUES} from '@/utils/property-types'
import {marketId} from './decision-contracts'
const reason=z.string().trim().min(3).max(2000)
export const IntakeRead=z.object({propertyId:marketId,requestId:marketId.optional(),cursor:marketId.optional(),view:z.enum(['saved','legacy']).default('saved')}).strict().refine(v=>!v.requestId||!v.cursor)
export const IntakeRequest=z.object({requestId:marketId,propertyId:marketId,rawText:z.string().min(20).max(100000).refine(s=>s.trim().length>=20),reason}).strict()
export const intakeUrl=z.string().trim().max(2000).refine(s=>{try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)&&!!u.hostname&&!u.username&&!u.password&&!/[<>\s]/.test(s)}catch{return false}},'Use a complete HTTP or HTTPS address').nullable()
export const IntakeCandidateDecision=z.discriminatedUnion('action',[
 z.object({id:marketId,action:z.literal('skip')}).strict(),
 z.object({id:marketId,action:z.literal('add'),propertyType:z.enum(PROPERTY_TYPE_VALUES),name:z.string().trim().min(1).max(200),location:z.string().trim().max(2000).nullable(),url:intakeUrl}).strict()
])
const common={requestId:marketId,propertyId:marketId,intakeId:marketId,expectedVersion:z.number().int().positive(),previewHash:z.string().regex(/^[0-9a-f]{64}$/),reason}
export const IntakeDecision=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('stop')}).strict(),
 z.object({...common,action:z.literal('apply'),acknowledgeUnverified:z.literal(true),candidates:z.array(IntakeCandidateDecision).min(1).max(50).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length)}).strict()
])
export const IntakeCandidate=z.object({id:marketId,ordinal:z.number().int().positive(),name:z.string(),location:z.string().nullable(),url:z.string().nullable(),sourceText:z.string(),claims:z.record(z.string(),z.string())})
export const IntakeRecord=z.object({id:marketId,state:z.enum(['preview_ready','applied','stopped']),version:z.number().int().positive(),preview_hash:z.string(),recipe:z.literal('operator-notes-v1'),input:z.object({rawText:z.string(),reason:z.string()}),preview:z.array(IntakeCandidate).min(1).max(50),created_at:z.string(),result:z.object({created:z.array(z.object({candidateId:marketId,competitorId:marketId,version:z.number()})),skipped:z.array(marketId)}).passthrough().nullable()})
export const IntakeDetail=z.object({state:z.literal('ready'),intake:IntakeRecord,existing:z.array(z.object({id:marketId,name:z.string(),isActive:z.boolean()})),decision:z.object({actorId:marketId,input:z.record(z.string(),z.unknown()),createdAt:z.string()}).nullable()})
export const IntakeHistory=z.object({state:z.literal('ready'),intakes:z.array(z.object({id:marketId,created_at:z.string(),state:z.string(),candidate_count:z.number().optional()})).max(20),total:z.number().int().nonnegative(),nextCursor:marketId.nullable(),legacy:z.boolean()})
export type SavedIntake=z.infer<typeof IntakeRecord>
export type IntakeDetailData=z.infer<typeof IntakeDetail>
export type IntakeHistoryData=z.infer<typeof IntakeHistory>
export type CandidateChoice=z.infer<typeof IntakeCandidateDecision>
