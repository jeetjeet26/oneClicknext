import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
export {sessionQuery as credentialQuery} from '@/utils/account-sessions/contracts'
export const credentialCommand=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('change'),requestId:id,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),currentPassword:z.string().min(1).max(1024),newPassword:z.string().min(8).max(128),confirmed:z.literal(true)}).strict().refine(v=>v.currentPassword!==v.newPassword,'Choose a different new password.'),
 z.object({operation:z.literal('reset'),requestId:id,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),newPassword:z.string().min(8).max(128),confirmed:z.literal(true)}).strict(),
 z.object({operation:z.enum(['check','cancel']),requestId:id}).strict(),
])
export type CredentialCommand=z.infer<typeof credentialCommand>
export type CredentialSource={state:string;actorId:string;sourceHash:string;canChange:boolean;canRecover?:boolean;recoveryExpiresAt?:string|null;pendingRequestId:string|null}
export type CredentialReceipt={state:string;actorId:string;requestId:string;status:'verifying'|'changing'|'confirmed'|'verification_failed'|'rejected'|'uncertain'|'cancelled';cleanupOutcome:string|null;createdAt:string;updatedAt:string;events?:{id:string;kind:string;createdAt:string}[]}
export function credentialMessage(r:CredentialReceipt){
 if(r.status==='confirmed')return 'Your password change is confirmed.'
 if(r.status==='cancelled')return 'The password request is cancelled. A late change from this request cannot be committed.'
 if(r.status==='verification_failed')return r.cleanupOutcome==='unconfirmed'?'Password verification could not be completed safely. Review your sessions before starting a new request.':'Your current password could not be verified.'
 if(r.status==='rejected')return 'The password change was rejected. Reload your account and sign in again if additional verification is required.'
 return 'Your password change is unconfirmed. Check the saved request without submitting another password, or cancel it to block a late change.'
}
