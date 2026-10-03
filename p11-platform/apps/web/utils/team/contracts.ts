import {z}from 'zod'
import {propertyIdSchema as id}from '@/utils/property-setup/contracts'
const hash=z.string().regex(/^[a-f0-9]{64}$/),role=z.enum(['admin','manager','viewer'])
const base={orgId:id,requestId:id,reason:z.string().trim().min(3).max(2000)},review={...base,confirmed:z.literal(true)}
export const teamCommand=z.discriminatedUnion('operation',[
 z.object({...review,operation:z.literal('change_role'),memberId:id,memberHash:hash,rosterHash:hash,role}).strict(),
 z.object({...review,operation:z.literal('remove_member'),memberId:id,memberHash:hash,rosterHash:hash}).strict(),
 z.object({...review,operation:z.literal('create_invitation'),email:z.string().trim().pipe(z.email().max(254)).transform(v=>v.toLowerCase()),role,expiresInDays:z.number().int().min(1).max(14)}).strict(),
 z.object({...review,operation:z.literal('rotate_invitation'),invitationId:id,invitationHash:hash,expiresInDays:z.number().int().min(1).max(14)}).strict(),
 z.object({...review,operation:z.literal('revoke_invitation'),invitationId:id,invitationHash:hash}).strict(),
 z.object({...base,operation:z.literal('cancel_unused'),inputHash:hash}).strict(),
 z.object({orgId:id,requestId:id,operation:z.literal('report_link_copy'),sourceDecisionId:id,outcome:z.enum(['copied','failed'])}).strict(),
])
export const teamQuery=z.object({orgId:id.optional(),kind:z.enum(['members','member','invitations','invitation','history','history_detail','decision']).default('members'),memberId:id.optional(),invitationId:id.optional(),decisionId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),expectedHash:hash.optional()}).strict().refine(v=>v.kind==='member'?!!v.memberId&&!v.invitationId&&!v.decisionId:v.kind==='invitation'?!!v.invitationId&&!v.memberId&&!v.decisionId:['history_detail','decision'].includes(v.kind)?!!v.decisionId&&!v.memberId&&!v.invitationId:!v.memberId&&!v.invitationId&&!v.decisionId)
export const joinCommand=z.discriminatedUnion('operation',[z.object({requestId:id,operation:z.enum(['accept','decline']),invitationHash:hash,confirmed:z.literal(true),reason:z.string().trim().min(3).max(2000)}).strict(),z.object({requestId:id,operation:z.literal('cancel_unused'),inputHash:hash}).strict()])
export const joinQuery=z.object({decisionId:id.optional()}).strict()
export const invitationSession=z.object({token:hash}).strict()
export type TeamCommand=z.infer<typeof teamCommand>
export type JoinCommand=z.infer<typeof joinCommand>
export type Member={id:string;orgId:string|null;name:string|null;email:string|null;role:string|null;emailConfirmed:boolean;accessBlocked:boolean;createdAt:string}
export type Invitation={id:string;orgId:string;createdBy:string;issuerId:string;email:string;role:'admin'|'manager'|'viewer';revision:number;status:string;effectiveStatus:string;expiresAt:string;acceptedBy:string|null;acceptedAt:string|null;createdAt:string;issuerAuthorized:boolean}
export type Page<T>={state:string;orgId:string;actorId:string;organizationName:string;canManage:boolean;items:T[];total:number;nextOffset:number|null;pageHash:string}
export type MemberDetail={orgId:string;member:Member;memberHash:string;rosterHash:string;canManage:boolean}
export type InvitationDetail={orgId:string;invitation:Invitation;invitationHash:string}
export type Decision={id:string;actorId:string;targetId:string|null;kind:string;reason:string;createdAt:string}
export type JoinContext={state:'ready';orgId:string;organization:{id:string;name:string};invitation:Invitation;recipient:Member;invitationHash:string;canJoin:boolean;alreadyMember:boolean}
