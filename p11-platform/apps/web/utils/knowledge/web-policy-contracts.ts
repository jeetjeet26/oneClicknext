import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
import {digest} from './material-contracts'
const base={requestId:id,propertyId:id,reason:z.string().trim().min(3).max(2000)}
export const webPolicyCommand=z.discriminatedUnion('operation',[
 z.object({...base,operation:z.literal('save'),expectedRevision:z.number().int().min(0).max(999999999),enabled:z.boolean(),intervalHours:z.number().int().min(24).max(168),dailyLimit:z.number().int().min(1).max(5),confirmed:z.literal(true)}).strict(),
 z.object({...base,operation:z.literal('cancel_unused'),inputHash:digest}).strict()
])
export const webPolicyQuery=z.object({propertyId:id,kind:z.enum(['policy','decision']).default('policy'),decisionId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),expectedHash:digest.optional()}).strict().refine(v=>v.kind==='decision'?!!v.decisionId:!v.decisionId)
export type WebPolicyCommand=z.infer<typeof webPolicyCommand>
export type WebPolicy={revision:number;enabled:boolean;interval_hours:number;daily_limit:number;updated_at:string}
export type PolicyPage={propertyId:string;canManage:boolean;policy:WebPolicy|null;ownerAuthorized:boolean;publishedWebsites:number;scheduledToday:number;execution:{paused:boolean};items:Array<{id:string;reason:string;created_at:string;actor_id:string;before_state:{policy:WebPolicy|null;unfinishedCaptures:Array<{id:string;state:string}>};after_state:WebPolicy;result:{stoppedCaptures:number}}> ;total:number;nextOffset:number|null;historyHash:string}
