import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
const digest=z.string().regex(/^[a-f0-9]{64}$/),instant=z.string().datetime({offset:true})
export const legalDocumentKeys=['privacy_policy','terms','accessibility','fair_housing','pricing_disclaimer','analytics_consent','communications_consent']as const
export const legalDocumentLabels:Record<typeof legalDocumentKeys[number],string>={privacy_policy:'Privacy policy',terms:'Terms',accessibility:'Accessibility statement',fair_housing:'Fair Housing statement',pricing_disclaimer:'Pricing disclaimer',analytics_consent:'Analytics and cookie consent',communications_consent:'Communications consent'}
const document=z.object({text:z.string().max(100000),sourceUrl:z.union([z.literal(''),z.string().url().max(4000).refine(v=>/^https?:\/\//.test(v)&&!new URL(v).username&&!new URL(v).password)]).optional(),reviewedAt:instant.nullable().optional()}).catchall(z.unknown())
export const legalDraft=z.object({jurisdiction:z.string().max(200),legalEntityName:z.string().max(300),effectiveAt:instant.nullable(),documents:z.object({privacy_policy:document,terms:document,accessibility:document,fair_housing:document,pricing_disclaimer:document,analytics_consent:document,communications_consent:document}).strict(),sourceReferences:z.array(z.record(z.string(),z.unknown())).max(200)}).strict()
const base={requestId:id,propertyId:id,reason:z.string().trim().min(3).max(2000)}
export const legalCommand=z.discriminatedUnion('operation',[
 z.object({...base,operation:z.literal('save'),expectedStateHash:digest,sourceVersionId:id.nullable(),draft:legalDraft}).strict(),
 z.object({...base,operation:z.enum(['approve','reject','withdraw']),expectedStateHash:digest,versionId:id,versionHash:digest,confirmed:z.literal(true)}).strict(),
 z.object({...base,operation:z.literal('cancel_unused'),inputHash:digest}).strict()
])
export const legalQuery=z.object({propertyId:id,kind:z.enum(['versions','version','history','history_detail','decision']).default('versions'),versionId:id.optional(),decisionId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),expectedHash:digest.optional()}).strict().refine(v=>v.kind==='version'?!!v.versionId&&!v.decisionId:['decision','history_detail'].includes(v.kind)?!!v.decisionId&&!v.versionId:!v.versionId&&!v.decisionId)
export type LegalDraft=z.infer<typeof legalDraft>
export type LegalCommand=z.infer<typeof legalCommand>
export type LegalSummary={id:string;version:number;status:'draft'|'approved'|'superseded'|'rejected';jurisdiction:string|null;legalEntityName:string|null;effectiveAt:string|null;approvedBy:string|null;approvedAt:string|null;createdAt:string;recorded:boolean}
export type LegalPage={propertyId:string;canManage:boolean;items:LegalSummary[];total:number;nextOffset:number|null;pageHash:string;stateHash:string;approvedCount:number;activeVersionId:string|null}
export type LegalVersion={id:string;version:number;status:LegalSummary['status'];approved_by:string|null;approved_at:string|null;effective_at:string|null}
export type LegalDetail={propertyId:string;canManage:boolean;version:LegalVersion;draft:LegalDraft;stateHash:string;versionHash:string;isLatest:boolean;recorded:boolean}
export type LegalHistory={items:Array<{id:string;versionId:string;kind:string;actorId:string;createdAt:string;reason:string}>;total:number;pageHash:string;nextOffset:number|null}
export function emptyLegalDraft():LegalDraft{return{jurisdiction:'',legalEntityName:'',effectiveAt:null,documents:{privacy_policy:{text:''},terms:{text:''},accessibility:{text:''},fair_housing:{text:''},pricing_disclaimer:{text:''},analytics_consent:{text:''},communications_consent:{text:''}},sourceReferences:[]}}
export function canApproveLegalDraft(draft:LegalDraft,now=Date.now()){return legalDraft.safeParse(draft).success&&draft.jurisdiction.trim().length>=2&&draft.legalEntityName.trim().length>=2&&draft.effectiveAt!==null&&Date.parse(draft.effectiveAt)<=now&&legalDocumentKeys.every(k=>draft.documents[k].text.trim().length>0)}
