import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyManagerAccess} from '@/utils/services/auth-guard'
import {FORGESTUDIO_OAUTH_NONCE_COOKIE,createSignedForgeStudioOAuthState,verifyForgeStudioOAuthCallback} from '@/utils/services/forgestudio-oauth-state'
import {getSocialAppCredentials} from './social-config'
import {decryptSecret,encryptSecret,secretFingerprint,socialRpc,REQUESTED_SCOPES,type SocialPlatform} from './social-security'
import {exchangeSocialAuthorization,socialAuthorizationUrl} from './oauth-provider'
export function getSiteUrl(){return process.env.NEXT_PUBLIC_SITE_URL||'http://localhost:3000'}
export function connectionsRedirect(params:Record<string,string>){const url=new URL('/dashboard/forgestudio',getSiteUrl());url.searchParams.set('tab','connections');for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);return NextResponse.redirect(url)}
function cookie(response:NextResponse,nonce:string){response.cookies.set(FORGESTUDIO_OAUTH_NONCE_COOKIE,nonce,{httpOnly:true,secure:getSiteUrl().startsWith('https:'),sameSite:'lax',path:'/api/forgestudio/social/callback',maxAge:nonce?15*60:0});return response}
function configPlatform(p:SocialPlatform){return p==='instagram'||p==='facebook'?'meta':p}
function fingerprint(platform:SocialPlatform,appId:string,appSecret:string,redirectUri:string){return secretFingerprint({platform,appId,appSecret,redirectUri})}
function uuidFromNonce(nonce:string){if(!/^[a-f0-9]{32}$/i.test(nonce))throw new Error('Invalid authorization identity');return `${nonce.slice(0,8)}-${nonce.slice(8,12)}-${nonce.slice(12,16)}-${nonce.slice(16,20)}-${nonce.slice(20)}`}
export async function beginSocialAuthorization(request:NextRequest,platform:SocialPlatform){
 try{
  const {data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)return connectionsRedirect({error:'Unauthorized'})
  const query=new URL(request.url).searchParams,propertyId=query.get('propertyId'),requestId=query.get('requestId')||randomUUID()
  if(!z.string().uuid().safeParse(propertyId).success||!z.string().uuid().safeParse(requestId).success)return connectionsRedirect({error:'Invalid property or request'})
  if(!(await validatePropertyManagerAccess(user.id,propertyId!)).authorized)return connectionsRedirect({error:'Forbidden'})
  if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return connectionsRedirect({propertyId:propertyId!,error:'Authorization is paused in this environment'})
  const c=await getSocialAppCredentials(propertyId!,configPlatform(platform));if(!c)return connectionsRedirect({propertyId:propertyId!,setup_required:platform})
  const redirectUri=new URL(`/api/forgestudio/social/callback/${platform}`,getSiteUrl()).toString()
  const saved=await socialRpc('begin_forgestudio_authorization',{p_id:requestId,p_property_id:propertyId,p_actor_id:user.id,p_payload:{platform,redirectUri,credentialFingerprint:fingerprint(platform,c.appId,c.appSecret,redirectUri),scopes:REQUESTED_SCOPES[platform]},p_credentials:{appId:c.appId,appSecretEncrypted:encryptSecret(c.appSecret),...(platform==='x'?{codeVerifierEncrypted:encryptSecret(randomBytes(32).toString('base64url'))}:{})}})
  if(saved.state!=='pending'||typeof saved.createdAt!=='string'||typeof saved.expiresAt!=='string'||Date.parse(saved.expiresAt)<=Date.now())return connectionsRedirect({propertyId:propertyId!,authorization:requestId,status:String(saved.state)})
  const privateCredentials=saved.credentials as Record<string,string>,nonce=requestId.replaceAll('-',''),state=createSignedForgeStudioOAuthState({propertyId:propertyId!,userId:user.id,nonce,timestamp:Date.parse(saved.createdAt)})
  const url=socialAuthorizationUrl(platform,{...c,redirectUri,...(platform==='x'?{codeVerifier:decryptSecret(privateCredentials.codeVerifierEncrypted)}:{})},state)
  return cookie(NextResponse.redirect(url),nonce)
 }catch{return connectionsRedirect({error:'Authorization could not start. Reload saved requests before trying again.'})}
}
export async function completeSocialAuthorization(request:NextRequest,platform:SocialPlatform){
 let propertyId:string|undefined,authorizationId:string|undefined
 const redirect=(params:Record<string,string>)=>cookie(connectionsRedirect({...propertyId?{propertyId}:{},...authorizationId?{authorization:authorizationId}:{},...params}),'')
 try{
  const {data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)return redirect({error:'Unauthorized'})
  const query=new URL(request.url).searchParams,state=query.get('state');if(!state)return redirect({error:'invalid_state'})
  try{const signed=verifyForgeStudioOAuthCallback({state,userId:user.id,nonceCookie:request.cookies.get(FORGESTUDIO_OAUTH_NONCE_COOKIE)?.value});propertyId=signed.propertyId;authorizationId=uuidFromNonce(signed.nonce)}catch{return redirect({error:'invalid_state'})}
  if(!(await validatePropertyManagerAccess(user.id,propertyId)).authorized)return redirect({error:'Forbidden'})
  const {data:saved,error:readError}=await createServiceClient().from('forgestudio_authorizations').select('id,state,decision_version').eq('id',authorizationId).eq('property_id',propertyId).eq('actor_id',user.id).eq('platform',platform).maybeSingle()
  if(readError||!saved)return redirect({error:'Saved authorization is unavailable. Reload its history.'})
  if(saved.state!=='pending')return redirect({status:saved.state})
  // Provider denial is only recorded after signed state, user, property and platform validation.
  if(query.has('error')){
   const bytes=createHash('sha256').update(`${authorizationId}:provider-denial`).digest('hex').slice(0,32),decisionId=uuidFromNonce(bytes)
   await socialRpc('cancel_forgestudio_authorization',{p_id:decisionId,p_property_id:propertyId,p_actor_id:user.id,p_payload:{authorizationId,expectedVersion:saved.decision_version,reason:'Provider authorization was declined or cancelled'}},['saved','replayed'])
   return redirect({status:'cancelled'})
  }
  const code=query.get('code');if(!code||code.length>8192)return redirect({error:'missing_params'})
  if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return redirect({error:'Authorization is paused in this environment'})
  const c=await getSocialAppCredentials(propertyId,configPlatform(platform)),redirectUri=new URL(`/api/forgestudio/social/callback/${platform}`,getSiteUrl()).toString()
  const claimed=await socialRpc('claim_forgestudio_authorization',{p_id:authorizationId,p_property_id:propertyId,p_actor_id:user.id,p_platform:platform,p_code_hash:secretFingerprint(code),p_credential_fingerprint:c?fingerprint(platform,c.appId,c.appSecret,redirectUri):'missing'})
  if(claimed.state!=='exchange_once')return redirect({status:String(claimed.state)})
  const privateCredentials=claimed.credentials as Record<string,string>,input=claimed.input as Record<string,string>
  const result=await exchangeSocialAuthorization(platform,{appId:privateCredentials.appId,appSecret:decryptSecret(privateCredentials.appSecretEncrypted),redirectUri:input.redirectUri,...privateCredentials.codeVerifierEncrypted?{codeVerifier:decryptSecret(privateCredentials.codeVerifierEncrypted)}:{}},code)
  // A lost database response retries only these same encrypted result bytes, never the provider exchange.
  const args={p_id:authorizationId,p_claim_token:claimed.claimToken,p_result:result};let finished:Record<string,unknown>
  try{finished=await socialRpc('finish_forgestudio_authorization',args,['saved','replayed'])}catch{finished=await socialRpc('finish_forgestudio_authorization',args,['saved','replayed'])}
  return redirect({status:String(finished.authorizationState)})
 }catch{return redirect({error:'Authorization result could not be confirmed. Check saved requests; do not repeat the callback.'})}
}
