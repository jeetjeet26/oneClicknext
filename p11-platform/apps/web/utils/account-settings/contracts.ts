import{z}from'zod'
import{propertyIdSchema as id}from'@/utils/property-setup/contracts'
const hash=z.string().regex(/^[a-f0-9]{64}$/),base={orgId:id,requestId:id,reason:z.string().trim().min(3).max(2000)},review={...base,sourceHash:hash,confirmed:z.literal(true)}
export const accountCommand=z.discriminatedUnion('operation',[
 z.object({...review,operation:z.literal('save_organization'),section:z.literal('organization'),name:z.string().trim().min(2).max(120),timezone:z.string().min(1).max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true}catch{return false}},'Choose a recognized time zone.')}).strict(),
 z.object({...review,operation:z.literal('save_profile'),section:z.literal('personal'),fullName:z.string().trim().min(1).max(120)}).strict(),
 z.object({...review,operation:z.literal('save_preferences'),section:z.literal('personal'),theme:z.enum(['light','dark','system']),accentColor:z.enum(['indigo','purple','blue','emerald'])}).strict(),
 z.object({...base,operation:z.literal('cancel_unused'),section:z.enum(['organization','personal']),inputHash:hash}).strict(),
])
export const accountQuery=z.object({orgId:id.optional(),kind:z.enum(['current','history','detail','decision']).default('current'),section:z.enum(['organization','personal']).default('personal'),decisionId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),expectedHash:hash.optional()}).strict().refine(v=>['detail','decision'].includes(v.kind)?!!v.decisionId:!v.decisionId)
export type AccountCommand=z.infer<typeof accountCommand>
export type Section='organization'|'personal'
export type Appearance={theme:'light'|'dark'|'system';accentColor:'indigo'|'purple'|'blue'|'emerald'}
export function appearanceValues(value:unknown):Appearance{const v=value&&typeof value==='object'?value as Record<string,unknown>:{};return{theme:v.theme==='light'||v.theme==='dark'?v.theme:'system',accentColor:v.accentColor==='purple'||v.accentColor==='blue'||v.accentColor==='emerald'?v.accentColor:'indigo'}}
export type AccountState={state:'ready';orgId:string;actorId:string;canManageOrganization:boolean;organization:{name:string;timezone:string|null};organizationHash:string;personal:{fullName:string|null;theme:unknown;accentColor:unknown};personalHash:string;email:string;role:string;subscriptionTier:string|null}
export type AccountDecision={id:string;actorId:string;kind:string;section:Section;reason:string;createdAt:string}
export type AccountPage={state:'ready';orgId:string;actorId:string;section:Section;items:AccountDecision[];total:number;nextOffset:number|null;pageHash:string}
