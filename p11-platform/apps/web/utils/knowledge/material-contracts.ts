import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
export const digest=z.string().regex(/^[a-f0-9]{64}$/)
export function validText(value:string){return !!value.trim()&&!/[\u0000\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)&&!value.includes('\0')&&new TextEncoder().encode(value).length<=262144}
const reason=z.string().trim().min(3).max(2000)
const base={requestId:id,propertyId:id,reason}
export const materialCommand=z.discriminatedUnion('operation',[
 z.object({...base,operation:z.literal('cancel_unused'),inputHash:digest}).strict(),
 z.object({...base,operation:z.literal('save'),materialId:id.nullable(),previousVersionId:id.nullable(),title:z.string().trim().min(1).max(300),content:z.string().refine(validText,'Enter complete valid text up to 256 KiB.')}).strict(),
 z.object({...base,operation:z.literal('prepare'),materialId:id,versionId:id,contentHash:digest,confirmed:z.literal(true)}).strict(),
 z.object({...base,operation:z.enum(['stop','recover']),searchId:id,expectedRevision:z.number().int().positive()}).strict(),
 z.object({...base,operation:z.enum(['publish','withdraw']),materialId:id,versionId:id,expectedLatestVersionId:id,expectedActiveVersionId:id.nullable(),expectedReleaseId:id.nullable(),resultHash:digest.nullable(),confirmed:z.literal(true)}).strict()
])
export const materialQuery=z.object({propertyId:id,kind:z.enum(['materials','versions','decisions','version','decision']).default('materials'),materialId:id.optional(),versionId:id.optional(),decisionId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),expectedHash:digest.optional()}).strict().refine(v=>v.kind==='materials'?(!v.materialId&&!v.versionId&&!v.decisionId):!!v.materialId&&(v.kind==='decision'?!!v.decisionId:!v.decisionId))
export type MaterialCommand=z.infer<typeof materialCommand>
export type SearchView={id:string;versionId:string;state:'queued'|'running'|'result_ready'|'ready'|'held'|'stopped';revision:number;resultHash:string|null;errorCode:string|null;chunks:number;model:string;receiptModel:string|null;usage:unknown;providerRequestId:string|null;cost:null;createdAt:string;startedAt:string|null;finishedAt:string|null;invocationClaimed:boolean}
export type Material={id:string;latest_version_id:string;active_version_id:string|null;last_release_id:string|null;updated_at:string;title?:string;content_hash?:string;search?:SearchView|null}
export type MaterialVersion={id:string;material_id:string;previous_version_id:string|null;title:string;content:string;content_hash:string;created_at:string;actor_id:string;version_sequence:number}
export type MaterialDetail={state:'ready';propertyId:string;canManage:boolean;historyHash:string;material:Material;version:MaterialVersion;search:SearchView|null;webOrigin?:{captureId:string;versionId:string;receiptHash:string;url:string;requestedUrl:string;fetchedAt:string;bodyHash:string;inherited:boolean}|null;fileOrigin?:{fileId:string;fileName:string;byteHash:string;versionId:string;extractionId:string;receiptHash:string;inherited:boolean}|null}
