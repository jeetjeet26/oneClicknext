import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
import {digest,validText,type Material} from './material-contracts'
const reason=z.string().trim().min(3).max(2000),base={requestId:id,propertyId:id,reason}
export const websiteUrl=z.string().max(2000).refine(value=>{try{const u=new URL(value);return['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.hash&&(!u.port||['80','443'].includes(u.port))&&u.hostname.includes('.')&&!u.hostname.endsWith('.localhost')}catch{return false}},'Use a complete public HTTP(S) page address without credentials or a fragment.')
export const webCommand=z.discriminatedUnion('operation',[
 z.object({...base,operation:z.literal('cancel_unused'),inputHash:digest}).strict(),
 z.object({...base,operation:z.literal('capture'),title:z.string().trim().min(1).max(300),url:websiteUrl,materialId:id.nullable(),parentCaptureId:id.nullable(),expectedParentRevision:z.number().int().positive().nullable()}).strict(),
 z.object({...base,operation:z.enum(['recover','stop','download']),captureId:id,expectedRevision:z.number().int().positive()}).strict(),
 z.object({...base,operation:z.literal('accept'),captureId:id,expectedRevision:z.number().int().positive(),receiptHash:digest,content:z.string().refine(validText,'Review complete text up to 256 KiB; shorter corrections must be explicit.'),materialId:id.nullable(),previousVersionId:id.nullable(),confirmed:z.literal(true)}).strict()
])
export const webQuery=z.object({propertyId:id,kind:z.enum(['captures','capture','decisions','decision']).default('captures'),captureId:id.optional(),decisionId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),expectedHash:digest.optional()}).strict().refine(v=>v.kind==='captures'?!v.captureId&&!v.decisionId:v.kind==='decision'?!!v.decisionId&&!v.captureId:!!v.captureId&&!v.decisionId)
export type WebCommand=z.infer<typeof webCommand>
export type WebReceipt={recipe:'public-utf8-html-v1';complete:boolean;requestedUrl:string;fetchedAt:string;finalUrl?:string;statusCode?:number;contentType?:string;body?:string;bodyHash?:string;text?:string;title?:string;errorCode?:string;limitations:string[]}
export type WebCapture={id:string;property_id:string;actor_id:string|null;origin:'operator'|'scheduled';policy_revision:number|null;source_material_id:string|null;source_version_id:string|null;parent_capture_id:string|null;input:{title:string;url:string;materialId:string|null;reason:string};revision:number;state:'queued'|'running'|'ready'|'held'|'stopped';receipt:WebReceipt|null;receipt_hash:string|null;accepted_version_id:string|null;material_id:string|null;created_at:string;started_at:string|null;finished_at:string|null}
export type WebDetail={propertyId:string;canManage:boolean;capture:WebCapture;material:Material|null;execution:{paused:boolean}}
