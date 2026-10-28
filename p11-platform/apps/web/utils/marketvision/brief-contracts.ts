import { decisionNote, requireDecisionNote } from '@/utils/actions/decision-note'
import {z} from 'zod'
const id=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const reason=decisionNote(2000, 3)
export const BriefRead=z.object({propertyId:id,requestId:id.optional(),cursor:id.optional(),view:z.literal('legacy').optional()}).strict().refine(v=>!v.requestId||!v.cursor)
export const BriefRequest=z.object({propertyId:id,requestId:id,windowDays:z.number().int().min(1).max(366),reason}).strict()
export const BriefRecovery=z.object({propertyId:id,requestId:id,briefId:id,expectedVersion:z.number().int().positive(),reason}).strict()
export const BriefReview=BriefRecovery.extend({recommendationId:id,decision:z.enum(['consider','dismiss']),acknowledgedSourceChange:z.boolean(),expectedReviewId:id.nullable()}).strict().superRefine((value, ctx) => { if (value.decision === 'dismiss' || value.acknowledgedSourceChange) requireDecisionNote(value, ctx) })

export const BriefExport=BriefRecovery.extend({format:z.enum(['json','markdown'])}).strict()
