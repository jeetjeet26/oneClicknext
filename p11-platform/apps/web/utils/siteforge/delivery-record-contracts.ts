import {z} from 'zod'
import {briefId} from './brief-history-contracts'
export const DELIVERY_CATEGORIES={design_routes:'Design and routes',editing:'Content editing',preview_revisions:'Private preview and revisions',facts_inventory:'Facts and inventory',inquiry_integrations:'Inquiries and integrations',accessibility_content:'Accessibility and housing content',imports_redirects:'Imports and redirects',package_runtime:'Package and runtime',domain_discovery:'Domain and discovery',recovery:'Backup and recovery',maintenance:'Maintenance and monitoring'} as const
export type DeliveryCategory=keyof typeof DELIVERY_CATEGORIES
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Use an actual calendar date.').refine(v=>v<=new Date().toISOString().slice(0,10),'Use the actual past observation date.').nullable()
const fields={sourceName:z.string().trim().min(1).max(300),sourceFormat:z.enum(['markdown','plain_text']),sourceOrigin:z.enum(['client_project_report','operator_report','legacy_record']),sourceText:z.string().min(20).max(262144).refine(v=>new TextEncoder().encode(v).length<=262144,'Use a delivery record under 256 KB.'),targetLabel:z.string().trim().min(1).max(1000),targetPurpose:z.enum(['local','review','staging','production','unconfirmed']),sourceRevision:z.string().max(1000),observedAt:date,contentSource:z.string().max(2000),editorOwner:z.string().max(2000),briefId:briefId.nullable(),parentId:briefId.nullable()}
export const DeliverySource=z.object(fields).strict()
const category=z.enum(Object.keys(DELIVERY_CATEGORIES) as[DeliveryCategory,...DeliveryCategory[]])
export const DeliveryCheck=z.object({category,status:z.enum(['passed','failed','not_run','blocked','out_of_scope']),evidence:z.string().max(2000),observedAt:date,notes:z.string().max(2000)}).strict().superRefine((v,ctx)=>{if(v.status==='passed'&&(!v.observedAt||v.evidence.trim().length<3))ctx.addIssue({code:'custom',message:'A reported pass needs dated evidence.'});if(['failed','blocked','out_of_scope'].includes(v.status)&&v.notes.trim().length<3)ctx.addIssue({code:'custom',message:'Explain failed, blocked or excluded checks.'})})
const common={requestId:briefId,propertyId:briefId},review={recordId:briefId,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),expectedReviewId:briefId.nullable(),reason:z.string().trim().min(3).max(2000)}
export const DeliveryDecision=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('record'),...fields}).strict(),
 z.object({...common,action:z.literal('review'),...review,checks:z.array(DeliveryCheck).length(11).refine(v=>new Set(v.map(x=>x.category)).size===11,'Review every acceptance category exactly once.')}).strict(),
 z.object({...common,action:z.literal('withdraw'),...review}).strict()
])
export const DeliveryRead=z.object({propertyId:briefId,cursor:briefId.optional(),recordId:briefId.optional(),reviewCursor:briefId.optional()}).strict().refine(v=>!v.reviewCursor||!!v.recordId)
export type DeliverySourceInput=z.infer<typeof DeliverySource>
export type DeliveryCheckInput=z.infer<typeof DeliveryCheck>
export const blankDeliveryChecks=():DeliveryCheckInput[]=>Object.keys(DELIVERY_CATEGORIES).map(category=>({category:category as DeliveryCategory,status:'not_run',evidence:'',observedAt:null,notes:''}))
