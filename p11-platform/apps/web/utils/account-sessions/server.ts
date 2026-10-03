import {localSessionRequestId} from './contracts'
import {cookies} from 'next/headers'
import {createClient} from '@/utils/supabase/server'
import {getSupabaseUrl} from '@/utils/supabase/config'
import {propertyIdSchema} from '@/utils/property-setup/contracts'
import {executeSessionDecision,readSessions,SessionError,type SessionActor} from './store'
export async function sessionActor(){
 const client=await createClient(),{data,error}=await client.auth.getSession(),token=data.session?.access_token
 if(error||!token)throw new SessionError('Sign in again to review your private session history.',401)
 const [user,verified]=await Promise.all([client.auth.getUser(token),client.auth.getClaims(token)])
 const claims=verified.data?.claims,sessionId=propertyIdSchema.safeParse(claims?.session_id)
 if(user.error||!user.data.user||verified.error||!claims||claims.sub!==user.data.user.id||!sessionId.success)throw new SessionError('Your signed-in session could not be verified. Sign in again.',401)
 const actor:SessionActor={actorId:user.data.user.id,sessionId:sessionId.data,aal:String(claims.aal||'aal1')}
 return {actor,email:user.data.user.email,changePassword:(password:string,claim:string)=>client.auth.updateUser({password,data:{p11_credential_request:claim}}),provider:(scope:'local'|'others')=>client.auth.admin.signOut(token,scope)}
}
export async function clearSessionCookies(){
 const jar=await cookies(),base='sb-'+new URL(getSupabaseUrl()).hostname.split('.')[0]+'-auth-token'
 for(const c of jar.getAll())if(c.name===base||c.name.startsWith(base+'.')&&/^\d+$/.test(c.name.slice(base.length+1)))jar.set(c.name,'',{path:'/',maxAge:0,sameSite:'lax'})
}
export async function recordedCurrentSignOut(){
 const {actor,provider}=await sessionActor(),source=await readSessions(actor)
 const result=await executeSessionDecision(actor,{operation:'revoke',requestId:await localSessionRequestId(actor.sessionId),scope:'local',sourceHash:String(source.sourceHash),confirmed:true},provider)
 if(result.status!=='acknowledged')throw new SessionError('Sign-out is unconfirmed. Open account security to check its saved request.')
 await clearSessionCookies()
}
