import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
const hash=z.string().regex(/^[a-f0-9]{64}$/)
export const sessionCommand=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('revoke'),requestId:id,scope:z.enum(['local','others']),sourceHash:hash,confirmed:z.literal(true)}).strict(),
 z.object({operation:z.enum(['check','cancel_unused']),requestId:id}).strict(),
])
export const sessionQuery=z.object({kind:z.enum(['current','history','detail']).default('current'),requestId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),expectedHash:hash.optional()}).strict().refine(v=>v.kind==='detail'?!!v.requestId:!v.requestId)
export type SessionCommand=z.infer<typeof sessionCommand>
export type SessionRow={id:string;createdAt:string;lastSeenAt:string|null;expiresAt:string|null;agent:string|null;current:boolean}
export type SessionSource={state:'ready';actorId:string;sessionId:string;sourceHash:string;sessions:SessionRow[];requiresMfa:boolean;canRevoke:boolean}
export type SessionReceipt={state:string;actorId:string;requestId:string;scope:'local'|'others'|null;status:'claimed'|'acknowledged'|'rejected'|'uncertain'|'observed'|'cancelled';providerResult:string|null;observation:{reviewedRemaining:number;reviewedAbsent:boolean;otherSessionsNow:number}|null;createdAt:string;updatedAt:string;reviewedCount:number;events?:{id:string;kind:string;facts:Record<string,unknown>;createdAt:string}[]}
export function sessionMessage(r:SessionReceipt){
 if(r.status==='acknowledged')return r.scope==='local'?'The provider confirmed this session was signed out.':'The provider confirmed other sessions were signed out.'
 if(r.status==='cancelled')return 'This unused request was cancelled. No sign-out was started.'
 if(r.status==='rejected')return 'The provider rejected this sign-out request. Review your current sessions before trying a new request.'
 if(r.observation?.reviewedAbsent)return 'The reviewed sessions are no longer in the active-session list. The original provider reply is unconfirmed; this observation does not prove which action removed them.'
 return 'The provider result is unconfirmed. Checking this request never sends another sign-out. Sessions still listed may require a new, explicitly reviewed request.'
}

export async function localSessionRequestId(sessionId:string){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('p11.current-session.signout.v1:'+sessionId)))
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128
 const h=Array.from(bytes.slice(0,16),v=>v.toString(16).padStart(2,'0')).join('')
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}

export function sessionDeviceLabel(agent:string|null){
 if(agent==='P11 password verification')return 'Password verification session'
 if(!agent||['node','undici'].includes(agent.toLowerCase()))return 'Browser details not supplied'
 const browser=/Edg\//.test(agent)?'Edge':/Firefox\//.test(agent)?'Firefox':/Chrome\//.test(agent)?'Chrome':/Safari\//.test(agent)?'Safari':null
 const system=/iPhone|iPad/.test(agent)?'iOS':/Android/.test(agent)?'Android':/Windows/.test(agent)?'Windows':/Macintosh|Mac OS X/.test(agent)?'macOS':/Linux/.test(agent)?'Linux':null
 return browser?[browser,system?'on '+system:null].filter(Boolean).join(' '):'Browser details not recognized'
}
