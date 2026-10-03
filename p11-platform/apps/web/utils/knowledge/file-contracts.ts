import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
import {digest,validText} from './material-contracts'
const reason=z.string().trim().min(3).max(2000)
const base={requestId:id,propertyId:id,fileId:id,expectedRevision:z.number().int().positive(),reason}
export const fileUploadFields=z.object({requestId:id,propertyId:id,title:z.string().trim().min(1).max(300),materialId:id.nullable(),reason}).strict()
export const fileCommand=z.discriminatedUnion('operation',[
 z.object({requestId:id,propertyId:id,operation:z.literal('cancel_unused'),inputHash:digest,reason}).strict(),
 z.object({...base,operation:z.enum(['stop_upload','recover_upload','extract','download'])}).strict(),
 z.object({...base,operation:z.enum(['stop_extraction','recover_extraction']),extractionId:id,expectedExtractionRevision:z.number().int().positive()}).strict(),
 z.object({...base,operation:z.literal('accept'),extractionId:id,expectedExtractionRevision:z.number().int().positive(),receiptHash:digest,content:z.string().refine(validText),materialId:id.nullable(),previousVersionId:id.nullable(),confirmed:z.literal(true)}).strict()
])
export const fileQuery=z.object({propertyId:id,kind:z.enum(['files','file','extractions','decisions','decision','extraction']).default('files'),fileId:id.optional(),extractionId:id.optional(),decisionId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),expectedHash:digest.optional()}).strict().refine(v=>v.kind==='files'?!v.fileId&&!v.decisionId&&!v.extractionId:v.kind==='decision'?!!v.decisionId&&!v.extractionId:!!v.fileId&&!v.decisionId&&(v.kind==='extraction'?!!v.extractionId:!v.extractionId))
export type FileCommand=z.infer<typeof fileCommand>
export type OriginalFile={id:string;property_id:string;org_id:string;actor_id:string;input:{title:string;fileName:string;mimeType:string;size:number;byteHash:string;reason:string;materialId:string|null};storage_path:string;state:'pending'|'stored'|'stopped';revision:number;latest_extraction_id:string|null;accepted_version_id:string|null;created_at:string;stored_at:string|null}
export type FileReceipt={recipe:string;fileHash:string;complete:boolean;totalPages:number|null;pages:string[];text:string;errorCode:string|null;blankPages:number[];limitations:string[]}
export type FileExtraction={id:string;file_id:string;state:'queued'|'running'|'ready'|'held'|'stopped';revision:number;receipt:FileReceipt|null;receipt_hash:string|null;created_at:string}
export type FileDetail={state:'ready';propertyId:string;canManage:boolean;file:OriginalFile;extraction:FileExtraction|null;destinationMaterial:{id:string;latestVersionId:string;title:string;content:string}|null;acceptedMaterial:{id:string;latestVersionId:string;activeVersionId:string|null}|null}
