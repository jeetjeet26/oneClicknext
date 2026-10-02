import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
import {digest} from './material-contracts'
const reason=z.string().trim().min(3).max(2000),base={requestId:id,propertyId:id,reason}
const text=z.string().min(1).refine(s=>!!s.trim()&&!s.includes('\0')&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s)&&new TextEncoder().encode(s).length<=5242880)
export const factCommand=z.discriminatedUnion('operation',[
 z.object({...base,operation:z.literal('prepare'),expectedDraftId:id.nullable(),expectedSourceHash:digest,expectedContextHash:digest,markdown:z.null()}).strict(),
 z.object({...base,operation:z.literal('edit'),expectedDraftId:id,expectedSourceHash:digest,expectedContextHash:digest,markdown:text}).strict(),
 z.object({...base,operation:z.enum(['publish','withdraw']),versionId:id,expectedDraftId:id,expectedActiveId:id.nullable(),expectedReleaseId:id.nullable(),expectedContextHash:digest,markdownHash:digest,confirmed:z.literal(true)}).strict(),
 z.object({...base,operation:z.literal('cancel_unused'),inputHash:digest}).strict()
])
export const factQuery=z.object({propertyId:id,kind:z.enum(['current','versions','decisions','decision']).default('current'),versionId:id.optional(),decisionId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),expectedHash:digest.optional()}).strict().refine(v=>(v.kind==='decision'?!!v.decisionId:!v.decisionId)&&(!v.versionId||v.kind==='current'))
export type FactCommand=z.infer<typeof factCommand>
export type SourceSummary={units:number;eligibleUnits:number;sources:number;completedSources:number;documents:number;legacyDocuments:number;snapshotBytes:number}
export type FactVersion={id:string;property_id:string;actor_id:string;previous_version_id:string|null;origin:'prepared'|'edited';created_at:string;source_snapshot:Record<string,unknown>;source_hash:string;markdown:string;markdown_hash:string;summary:SourceSummary;bytes:number;withinBudget:boolean;sourcesCurrent:boolean}
export type FactWorkspace={latest_version_id:string|null;active_version_id:string|null;last_release_id:string|null}
export type FactRead={state:'ready';propertyId:string;canManage:boolean;historyHash:string;workspace:FactWorkspace|null;selected:FactVersion|null;currentContext:{context_markdown:string;status:string;version:number;requires_review:boolean;last_generated_at:string|null}|null;contextHash:string;sourceHash:string;sourceSummary:SourceSummary;sourceBudgetBytes:number;publicationBudgetBytes:number;serving:{state:'ready'|'legacy'|'withheld';reason?:string;freshnessReviewDue?:boolean;freshnessReviewReason?:string}}
