import {z}from 'zod'
export const briefId=z.string().regex(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i)
export const CodexDraft=z.object({request:z.string().trim().min(1).max(8000),references:z.string().max(6000),target:z.enum(['existing','wordpress','standalone']),revision:z.object({keepUnchanged:z.string().max(3000),parentVersion:z.string().max(2000)}).strict(),delivery:z.object({projectLocation:z.string().max(2000),contentOwnership:z.string().max(2000),inquiryDestination:z.string().max(2000)}).strict()}).strict()
export const BriefSave=z.object({requestId:briefId,propertyId:briefId,parentId:briefId.nullable(),property:z.object({id:briefId,name:z.string().min(1).max(1000),city:z.string().max(1000).nullable()}).strict(),draft:CodexDraft}).strict().refine(v=>v.property.id===v.propertyId)
export const BriefRead=z.object({propertyId:briefId,cursor:briefId.optional(),briefId:briefId.optional(),exportCursor:briefId.optional()}).strict()
export const BriefExport=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare'),requestId:briefId,propertyId:briefId,briefId,mode:z.enum(['copy','download'])}).strict(),
 z.object({action:z.literal('report'),propertyId:briefId,exportId:briefId,result:z.enum(['clipboard_succeeded','clipboard_failed','download_started','download_failed'])}).strict()
])
export type CodexDraftInput=z.infer<typeof CodexDraft>
