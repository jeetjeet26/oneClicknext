import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type {Database,Json} from '@/types/supabase'
import type {SupabaseClient} from '@supabase/supabase-js'
import { createServiceClient } from '@/utils/supabase/admin'
import { getAppBaseUrl } from './runtime-config'
import type {
  IntegrationCapability,
  IntegrationProvider,
} from './integration-provider-config'

const DEFAULT_INVITE_TTL_HOURS = 168

export type IntegrationAuthInvite = {
  id: string
  property_id: string
  provider: IntegrationProvider
  requested_capabilities: IntegrationCapability[]
  token_hash: string
  token_preview: string | null
  expires_at: string
  consumed_at: string | null
  revoked_at: string | null
  created_by_profile_id: string | null
}

export function createInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function safeTokenHashEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function buildExternalIntegrationLink(token: string): string {
  const url = new URL('/lumaleasing/integrations/connect', getAppBaseUrl())
  url.searchParams.set('token', token)
  return url.toString()
}

export function getInviteExpiresAt(hours = DEFAULT_INVITE_TTL_HOURS): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

type InviteDatabase=Omit<Database,'public'> & {public:Omit<Database['public'],'Functions'> & {Functions:Database['public']['Functions'] & {
 create_recorded_integration_invite:{Args:{p_property_id:string;p_actor_id:string;p_request_id:string;p_provider:string;p_capabilities:string[];p_token_hash:string};Returns:Json}
 revoke_recorded_integration_invite:{Args:{p_property_id:string;p_actor_id:string;p_invite_id:string;p_request_id:string};Returns:Json}
}}}
const privateDb=()=>createServiceClient() as unknown as SupabaseClient<InviteDatabase>
const invitationMessages:Record<string,string>={forbidden:'This property is unavailable.',request_conflict:'This request belongs to a different decision. Start a new request.',link_unavailable:'This link cannot be recovered. Check its status before creating a new link.',not_found:'Authorization link not found.'}
async function confirmed(operation:()=>PromiseLike<{data:unknown;error:unknown}>) {
 for(let n=0;n<2;n++){
  try{const response=await operation();if(response.error)throw response.error
   if(!response.data||typeof response.data!=='object'||!('state' in response.data)||typeof response.data.state!=='string')throw new Error('Invalid acknowledgement')
   return response.data as {state:string;actionEventId?:string;invite?:{id:string;property_id:string;expires_at:string};replayed?:boolean}
  }catch{if(n===1)throw new Error('The saved link decision could not be confirmed. Retry the same request.')}
 }
 throw new Error('Link decision unavailable.')
}
export async function createIntegrationAuthInvite(params: {
 requestId:string;propertyId:string;provider:IntegrationProvider;capabilities:IntegrationCapability[];createdByProfileId:string
}) {
 // Domain-separated deterministic capability: retry can recover the same link without
 // storing its raw token or an encrypted second copy. Key rotation holds old recovery.
 const secret=process.env.INTEGRATION_INVITE_SECRET||process.env.INTEGRATION_OAUTH_STATE_SECRET||process.env.GMAIL_OAUTH_STATE_SECRET||process.env.GOOGLE_CLIENT_SECRET||process.env.MICROSOFT_CLIENT_SECRET
 if(!secret)throw new Error('Client authorization links are not configured.')
 const token=createHmac('sha256',secret).update(JSON.stringify(['p11-integration-invite-v1',params.requestId,params.propertyId,params.createdByProfileId])).digest('base64url')
 const db=privateDb(),args={p_property_id:params.propertyId,p_actor_id:params.createdByProfileId,p_request_id:params.requestId,p_provider:params.provider,p_capabilities:[...new Set(params.capabilities)].sort(),p_token_hash:hashInviteToken(token)}
 const data=await confirmed(()=>db.rpc('create_recorded_integration_invite',args))
 if(!['created','replayed'].includes(data.state))throw new Error(invitationMessages[data.state]||'Authorization link could not be confirmed.')
 if(data.actionEventId!==params.requestId||data.invite?.id!==params.requestId||data.invite?.property_id!==params.propertyId||!Number.isFinite(Date.parse(data.invite.expires_at))||Date.parse(data.invite.expires_at)<=Date.now())throw new Error('Authorization link could not be confirmed.')
 return {invite:data.invite,token,url:buildExternalIntegrationLink(token),actionEventId:data.actionEventId,replayed:data.state==='replayed'}
}
export async function revokeIntegrationAuthInvite(params:{propertyId:string;actorId:string;inviteId:string;requestId:string}) {
 const db=privateDb(),args={p_property_id:params.propertyId,p_actor_id:params.actorId,p_invite_id:params.inviteId,p_request_id:params.requestId}
 const data=await confirmed(()=>db.rpc('revoke_recorded_integration_invite',args))
 if(!['revoked','already_used'].includes(data.state))throw new Error(invitationMessages[data.state]||'Authorization link revocation could not be confirmed.')
 if(data.actionEventId!==params.requestId)throw new Error('Authorization link revocation could not be confirmed.')
 return data
}

export async function getValidIntegrationAuthInviteByToken(
  token: string
): Promise<IntegrationAuthInvite | null> {
  const tokenHash = hashInviteToken(token)
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('integration_auth_invites')
    .select('id, property_id, provider, requested_capabilities, token_hash, token_preview, expires_at, consumed_at, revoked_at, created_by_profile_id')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  if (
    data.consumed_at ||
    data.revoked_at ||
    new Date(data.expires_at).getTime() <= Date.now() ||
    !safeTokenHashEquals(data.token_hash, tokenHash)
  ) {
    return null
  }

  return data as IntegrationAuthInvite
}

/** Possession of the unguessable link authorizes only this small public summary. */
export async function readIntegrationInviteLink(token:string) {
 if(!/^[A-Za-z0-9_-]{20,256}$/.test(token))return null
 const {data,error}=await createServiceClient().from('integration_auth_invites')
  .select('provider, requested_capabilities, expires_at, consumed_at, revoked_at, properties(name)')
  .eq('token_hash',hashInviteToken(token)).maybeSingle()
 if(error)throw new Error('Authorization link status is unavailable.')
 if(!data)return null
 return {provider:data.provider as IntegrationProvider,capabilities:data.requested_capabilities as IntegrationCapability[],propertyName:data.properties?.name||'the selected property',expiresAt:data.expires_at,state:data.consumed_at?'used':data.revoked_at?'revoked':!Number.isFinite(Date.parse(data.expires_at))||Date.parse(data.expires_at)<=Date.now()?'expired':'pending'}
}
