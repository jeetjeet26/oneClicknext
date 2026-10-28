import { decisionNote, requireDecisionNote } from '@/utils/actions/decision-note'
import {z} from 'zod'
const id=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const reason=decisionNote(2000, 3)
export const HandoffRead=z.object({propertyId:id,briefId:id.optional(),handoffId:id.optional(),cursor:id.optional()}).strict().refine(v=>!v.handoffId||!v.cursor)
export const HandoffPrepare=z.object({propertyId:id,requestId:id,briefId:id,expectedVersion:z.number().int().positive(),recommendationId:id,expectedReviewId:id,title:z.string().trim().min(1).max(300),objective:z.string().trim().min(1).max(2000),channel:z.enum(['facebook','instagram','linkedin','tiktok','x']),format:z.enum(['text','image','video','reel','carousel','story']),reason}).strict().refine(v=>(v.channel!=='instagram'||v.format!=='text')&&(v.channel!=='tiktok'||['video','reel'].includes(v.format)))
export const HandoffDecision=z.object({propertyId:id,requestId:id,handoffId:id,expectedVersion:z.number().int().positive(),draftHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approve','reject','withdraw']),reason}).strict().superRefine((value, ctx) => { if (value.decision === 'reject') requireDecisionNote(value, ctx) })

export interface DraftIntent {title:string;objective:string;topic:string;sourceFacts:Array<{text:string;source:string}>;constraints:{mustAvoid:string[];mustInclude:string[]};channels:string[];formatPlan:Array<{platform:string;contentFormat:string;quantity:number}>}
export interface HandoffSummary {id:string;briefId:string;recommendationId:string;state:'prepared'|'completed'|'rejected'|'withdrawn';title:string;reason:string;createdAt:string}
export interface HandoffDetail {handoff:{id:string;brief_id:string;version:number;state:HandoffSummary['state'];draft:DraftIntent;draft_hash:string;input:{reason:string};receipt:{contentBriefId:string|null}|null;created_at:string};sourceChanged:boolean|null;reviewChanged:boolean;canApprove:boolean;canWithdraw:boolean}
