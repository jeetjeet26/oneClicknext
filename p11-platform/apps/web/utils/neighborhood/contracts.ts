import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
const digest=z.string().regex(/^[a-f0-9]{64}$/)
const decimal=(min:number,max:number,places:number)=>z.number().min(min).max(max).refine(v=>Math.abs(v*10**places-Math.round(v*10**places))<0.000001,'Use the supported decimal precision').nullable()
export const neighborhoodDraft=z.object({name:z.string().max(300),category:z.string().max(100),address:z.record(z.string(),z.unknown()),latitude:decimal(-90,90,6),longitude:decimal(-180,180,6),distanceMiles:decimal(0,999999.99,2),travelTimeMinutes:z.number().int().min(0).max(2147483647).nullable(),sourceUrl:z.union([z.literal(''),z.string().url().max(4000).refine(v=>/^https?:\/\//.test(v)&&!new URL(v).username&&!new URL(v).password)]),capturedAt:z.string().datetime({offset:true}).nullable(),confidence:decimal(0,1,4)}).strict().refine(v=>(v.latitude===null)===(v.longitude===null),'Supply both coordinates or leave both unknown')
const base={requestId:id,propertyId:id,reason:z.string().trim().min(3).max(2000)},existing={pointId:id,expectedStateHash:digest,confirmed:z.literal(true)}
export const neighborhoodCommand=z.discriminatedUnion('operation',[
 z.object({...base,operation:z.literal('save'),pointId:id.nullable(),expectedStateHash:digest,draft:neighborhoodDraft}).strict(),
 z.object({...base,...existing,operation:z.enum(['approve','reject']),versionId:id}).strict(),
 z.object({...base,...existing,operation:z.enum(['withdraw','archive','restore'])}).strict(),
 z.object({...base,operation:z.literal('cancel_unused'),inputHash:digest}).strict()
])
export const neighborhoodQuery=z.object({propertyId:id,kind:z.enum(['points','point','versions','version','history','history_detail','decision']).default('points'),pointId:id.optional(),versionId:id.optional(),decisionId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),expectedHash:digest.optional()}).strict().refine(v=>['point','versions'].includes(v.kind)?!!v.pointId&&!v.versionId&&!v.decisionId:v.kind==='version'?!!v.pointId&&!!v.versionId&&!v.decisionId:['decision','history_detail'].includes(v.kind)?!!v.decisionId&&!v.pointId&&!v.versionId:!v.pointId&&!v.versionId&&!v.decisionId)
export type NeighborhoodDraft=z.infer<typeof neighborhoodDraft>
export type NeighborhoodCommand=z.infer<typeof neighborhoodCommand>
export type NeighborhoodPage={propertyId:string;canManage:boolean;items:Array<{id:string;name:string;draftName:string|null;approvalStatus:string;archived:boolean;recorded:boolean}>;total:number;nextOffset:number|null;pageHash:string;emptyStateHash:string;approvedCount:number}
export type NeighborhoodSource={workspace:{archived:boolean}|null;point:Record<string,unknown>|null;latestVersion:{id:string;draft:NeighborhoodDraft;created_at:string;actor_id:string}|null;latestReview:{id:string;kind:string;versionId:string}|null}
export type NeighborhoodDetail={propertyId:string;canManage:boolean;pointId:string;source:NeighborhoodSource;stateHash:string;draft:NeighborhoodDraft}
export type NeighborhoodHistory={items:Array<{id:string;pointId:string;kind:string;actorId:string;createdAt:string;reason:string}>;total:number;pageHash:string;nextOffset:number|null}
export function emptyNeighborhoodDraft():NeighborhoodDraft{return{name:'',category:'',address:{},latitude:null,longitude:null,distanceMiles:null,travelTimeMinutes:null,sourceUrl:'',capturedAt:null,confidence:null}}
export function canApproveNeighborhood(draft:NeighborhoodDraft,now=Date.now()){return neighborhoodDraft.safeParse(draft).success&&draft.name.trim().length>0&&draft.category.trim().length>0&&draft.sourceUrl!==''&&draft.capturedAt!==null&&Date.parse(draft.capturedAt)<=now&&draft.confidence!==null}
export function pointDraft(value:Record<string,unknown>):NeighborhoodDraft{return{name:String(value.name||''),category:String(value.category||''),address:value.address as Record<string,unknown>||{},latitude:value.latitude as number|null,longitude:value.longitude as number|null,distanceMiles:value.distance_miles as number|null,travelTimeMinutes:value.travel_time_minutes as number|null,sourceUrl:String(value.source_url||''),capturedAt:value.captured_at as string|null,confidence:value.confidence as number|null}}
