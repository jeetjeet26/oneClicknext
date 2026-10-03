import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
const hash=z.string().regex(/^[a-f0-9]{64}$/)
export const readinessCapabilities=['crm','tours','chatbot','analytics']as const
const base={propertyId:id,requestId:id,reason:z.string().trim().min(3).max(2000)}
export const readinessCommand=z.discriminatedUnion('operation',[
 z.object({...base,operation:z.literal('build'),enabledCapabilities:z.array(z.enum(readinessCapabilities)).max(4).refine(v=>new Set(v).size===v.length,'Choose each capability once')}).strict(),
 z.object({...base,operation:z.enum(['approve','reject','withdraw']),snapshotId:id,snapshotHash:hash,sourceHash:hash,confirmed:z.literal(true),allowManagerOverride:z.boolean().optional()}).strict(),
 z.object({...base,operation:z.literal('cancel_unused'),inputHash:hash}).strict()
])
export const readinessQuery=z.object({propertyId:id,kind:z.enum(['snapshots','snapshot','history','history_detail','decision','invalidations','active']).default('snapshots'),snapshotId:id.optional(),decisionId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),expectedHash:hash.optional()}).strict().refine(v=>v.kind==='snapshot'?!!v.snapshotId&&!v.decisionId:['decision','history_detail'].includes(v.kind)?!!v.decisionId&&!v.snapshotId:!v.snapshotId&&!v.decisionId)
export type ReadinessCommand=z.infer<typeof readinessCommand>
export type ReadinessCapability=typeof readinessCapabilities[number]
export type Eligibility={canApprove:boolean;current:boolean;legacy?:boolean;reason?:string;requiresManagerOverride?:boolean;hardBlockers?:Array<{domain:string;reasons:string[]}>;overrideableConflicts?:Array<{domain:string;reasons:string[]}>}
export type ReadinessPage={propertyId:string;canManage:boolean;items:Array<{id:string;status:string;createdAt:string;approvedAt:string|null;approvedBy:string|null;contentHash:string;recorded:boolean;requestedCapabilities:ReadinessCapability[]|null;eligibility:Eligibility}>;total:number;nextOffset:number|null;pageHash:string}
export type DomainReport={state:string;blocking:boolean;approvalPolicy:string;reasons:string[];sourceIds:string[]}
export type ReadinessDetail={propertyId:string;canManage:boolean;snapshot:{id:string;status:string;created_at:string;approved_at:string|null;approved_by:string|null;content_hash:string;domain_reports:Record<string,DomainReport>;snapshot_payload:Record<string,unknown>};snapshotHash:string;sourceHash:string|null;sources:Record<string,unknown>|null;eligibility:Eligibility}
export type ReadinessHistory={items:Array<{id:string;snapshotId:string;kind:string;actorId:string;createdAt:string;reason:string}>;total:number;nextOffset:number|null;pageHash:string}
