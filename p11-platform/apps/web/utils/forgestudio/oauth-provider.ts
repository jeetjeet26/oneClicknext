import {createHash} from 'node:crypto'
import {encryptSecret,REQUESTED_SCOPES,type SocialPlatform} from './social-security'

type ObjectValue=Record<string,unknown>
export type OAuthCredentials={appId:string;appSecret:string;redirectUri:string;codeVerifier?:string}
export type OAuthAccount={platform:SocialPlatform;accountId:string;accountName:string|null;accountUsername:string|null;accessTokenEncrypted:string;refreshTokenEncrypted:string|null;pageAccessTokenEncrypted:string|null;pageId:string|null;expiresAt:string|null;refreshExpiresAt:string|null;scopes:string[];permissionEvidence:{source:'provider_response';expiryKnown:boolean}}
export type OAuthResult={status:'observed'|'failed'|'uncertain';observedAt:string;accounts:OAuthAccount[];reason?:string;tokenReceipt?:{accessTokenEncrypted:string;refreshTokenEncrypted:string|null;expiresAt:string|null;scopes:string[]}}
const object=(v:unknown):ObjectValue=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as ObjectValue:{}
const text=(v:unknown)=>typeof v==='string'&&v.trim().length>0?v:null
const id=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_.:@-]{1,256}$/.test(v)?v:null
const label=(v:unknown)=>text(v)?.slice(0,256)??null
function scopeValue(platform:SocialPlatform,value:unknown){if(platform!=='linkedin'||typeof value!=='string')return value;try{return decodeURIComponent(value.replaceAll('+',' '))}catch{return ''}}
const scopes=(v:unknown)=>typeof v==='string'?[...new Set(v.split(/[ ,]+/).filter(Boolean))].slice(0,100):[]
function expiry(value:unknown,startedAt:number){return typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=366*86400?new Date(startedAt+value*1000).toISOString():null}
class ProviderReadError extends Error {}
// Only fixed provider URLs are passed here. Redirects and unbounded response bodies are rejected.
async function json(url:URL|string,init:RequestInit={}):Promise<ObjectValue>{
 const response=await fetch(url,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20_000)})
 if(!response.ok)throw new ProviderReadError('Provider response unavailable')
 const reader=response.body?.getReader();if(!reader)throw new ProviderReadError('Empty provider response')
 const chunks:Uint8Array[]=[];let size=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1_048_576)throw new ProviderReadError('Provider response too large');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 let data:unknown;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new ProviderReadError('Invalid provider response')}
 const result=object(data);if(result.error&&object(result.error).code!=='ok')throw new ProviderReadError('Provider declined the request');return result
}
function form(body:Record<string,string>,headers:Record<string,string>={}):RequestInit{return{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(body)}}
export function socialAuthorizationUrl(platform:SocialPlatform,c:OAuthCredentials,state:string){
 const url=new URL(platform==='facebook'||platform==='instagram'?'https://www.facebook.com/v21.0/dialog/oauth':platform==='linkedin'?'https://www.linkedin.com/oauth/v2/authorization':platform==='tiktok'?'https://www.tiktok.com/v2/auth/authorize/':'https://x.com/i/oauth2/authorize')
 url.searchParams.set(platform==='tiktok'?'client_key':'client_id',c.appId);url.searchParams.set('response_type','code');url.searchParams.set('redirect_uri',c.redirectUri);url.searchParams.set('state',state);url.searchParams.set('scope',REQUESTED_SCOPES[platform].join(platform==='instagram'||platform==='facebook'||platform==='tiktok'?',':' '))
 if(platform==='x'){if(!c.codeVerifier)throw new Error('Saved PKCE verifier missing');url.searchParams.set('code_challenge',createHash('sha256').update(c.codeVerifier).digest('base64url'));url.searchParams.set('code_challenge_method','S256')}
 return url.toString()
}
async function metaList(path:string,token:string,fields?:string){
 const items:ObjectValue[]=[];let after:string|null=null;const seen=new Set<string>()
 for(let page=0;page<10;page++){
  const url=new URL(`https://graph.facebook.com/v21.0/me/${path}`);url.searchParams.set('limit','100');if(fields)url.searchParams.set('fields',fields);if(after)url.searchParams.set('after',after)
  const value=await json(url,{headers:{Authorization:`Bearer ${token}`}})
  if(!Array.isArray(value.data))throw new ProviderReadError('Account list missing');items.push(...value.data.map(object));if(items.length>100)throw new ProviderReadError('Too many accounts to review in one authorization')
  const paging=object(value.paging);if(!paging.next)return items
  after=text(object(paging.cursors).after);if(!after||seen.has(after))throw new ProviderReadError('Incomplete account pagination');seen.add(after)
 }
 throw new ProviderReadError('Account pagination incomplete')
}
/** One code exchange, no retries. Unknown/partial results never activate accounts. */
export async function exchangeSocialAuthorization(platform:SocialPlatform,c:OAuthCredentials,code:string):Promise<OAuthResult>{
 const startedAt=Date.now(),observedAt=new Date(startedAt).toISOString()
 try{
  let token:ObjectValue
  if(platform==='instagram'||platform==='facebook'){const endpoint=new URL('https://graph.facebook.com/v21.0/oauth/access_token');endpoint.search=new URLSearchParams({client_id:c.appId,client_secret:c.appSecret,redirect_uri:c.redirectUri,code}).toString();token=await json(endpoint,{method:'GET'})}
  else if(platform==='linkedin')token=await json('https://www.linkedin.com/oauth/v2/accessToken',form({grant_type:'authorization_code',code,client_id:c.appId,client_secret:c.appSecret,redirect_uri:c.redirectUri}))
  else if(platform==='tiktok')token=await json('https://open.tiktokapis.com/v2/oauth/token/',form({grant_type:'authorization_code',code,client_key:c.appId,client_secret:c.appSecret,redirect_uri:c.redirectUri}))
  else{if(!c.codeVerifier)throw new Error('Missing verifier');token=await json('https://api.x.com/2/oauth2/token',form({grant_type:'authorization_code',code,client_id:c.appId,redirect_uri:c.redirectUri,code_verifier:c.codeVerifier},{Authorization:`Basic ${Buffer.from(`${encodeURIComponent(c.appId)}:${encodeURIComponent(c.appSecret)}`).toString('base64')}`}))}
  return await observeSocialGrant(platform,token,startedAt)
 }catch{
  // A timeout or downstream read failure cannot establish whether the one-use code was consumed.
  return{status:'uncertain',observedAt,accounts:[],reason:'The exchange outcome is unconfirmed. Start fresh authorization.'}
 }
}

async function observeSocialGrant(platform:SocialPlatform,token:ObjectValue,startedAt:number):Promise<OAuthResult>{
 const observedAt=new Date(startedAt).toISOString();let tokenReceipt:OAuthResult['tokenReceipt']
 try{
  const accessToken=text(token.access_token);if(!accessToken||accessToken.length>8192)throw new ProviderReadError('Access token missing')
  const refreshToken=text(token.refresh_token),expiresAt=expiry(token.expires_in??token.expires,startedAt),refreshExpiresAt=expiry(platform==='linkedin'?token.refresh_token_expires_in:token.refresh_expires_in,startedAt),granted=scopes(scopeValue(platform,token.scope))
  tokenReceipt={accessTokenEncrypted:encryptSecret(accessToken),refreshTokenEncrypted:refreshToken?encryptSecret(refreshToken):null,expiresAt,scopes:granted}
  if(refreshToken&&refreshToken.length>8192||token.token_type!==undefined&&text(token.token_type)?.toLowerCase()!=='bearer')throw new ProviderReadError('Invalid token response')
  const common={platform,accessTokenEncrypted:tokenReceipt.accessTokenEncrypted,refreshTokenEncrypted:tokenReceipt.refreshTokenEncrypted,expiresAt,refreshExpiresAt,scopes:granted,pageAccessTokenEncrypted:null,pageId:null,permissionEvidence:{source:'provider_response' as const,expiryKnown:expiresAt!==null}}
  let accounts:OAuthAccount[]
  if(platform==='instagram'||platform==='facebook'){
   const permissions=await metaList('permissions',accessToken);const actual=[...new Set(permissions.filter(p=>p.status==='granted'&&typeof p.permission==='string').map(p=>String(p.permission)))]
   const pages=await metaList('accounts',accessToken,platform==='instagram'?'id,name,access_token,instagram_business_account{id,name,username}':'id,name,access_token')
   accounts=[]
   for(const page of pages){
    const profile=platform==='instagram'?object(page.instagram_business_account):page
    if(platform==='instagram'&&!page.instagram_business_account)continue
    const accountId=id(profile.id),pageId=id(page.id),pageToken=text(page.access_token)
    if(!accountId||!pageId||!pageToken||pageToken.length>8192)throw new ProviderReadError('Incomplete page grant')
    // User grant expiry is a conservative bound. No indefinite page-token lifetime is inferred.
    accounts.push({...common,accountId,accountName:label(profile.name)||label(page.name),accountUsername:label(profile.username),scopes:actual,pageId,pageAccessTokenEncrypted:encryptSecret(pageToken)})
   }
  }else{
   const url=platform==='linkedin'?'https://api.linkedin.com/v2/userinfo':platform==='tiktok'?'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name':'https://api.x.com/2/users/me?user.fields=username,name'
   const data=await json(url,{headers:{Authorization:`Bearer ${accessToken}`}}),profile=platform==='linkedin'?data:platform==='tiktok'?object(object(data.data).user):object(data.data)
   const accountId=id(platform==='linkedin'?profile.sub:platform==='tiktok'?profile.open_id:profile.id)
   if(!accountId||(platform==='tiktok'&&token.open_id!==accountId))throw new ProviderReadError('Account identity mismatch')
   accounts=[{...common,accountId,accountName:label(profile.name)||label(profile.display_name),accountUsername:label(profile.username)}]
  }
  if(!accounts.length||new Set(accounts.map(a=>a.accountId)).size!==accounts.length)throw new ProviderReadError('Account review is incomplete')
  return{status:'observed',observedAt,accounts}
 }catch{return{status:'uncertain',observedAt,accounts:[],reason:tokenReceipt?'The grant was received, but account evidence is incomplete. Start fresh authorization.':'The exchange outcome is unconfirmed. Start fresh authorization.',...(tokenReceipt?{tokenReceipt}:{})}}
}
export async function renewSocialAuthorization(platform:SocialPlatform,c:OAuthCredentials,connection:{accountId:string;accessToken:string|null;refreshToken:string|null;refreshExpiresAt?:string|null}):Promise<OAuthResult>{
 const startedAt=Date.now(),observedAt=new Date(startedAt).toISOString()
 try{
  let token:ObjectValue;let refreshOmitted=false
  if(platform==='facebook'||platform==='instagram'){
   if(!connection.accessToken)throw new Error('Fresh authorization required')
   const endpoint=new URL('https://graph.facebook.com/v21.0/oauth/access_token');endpoint.search=new URLSearchParams({grant_type:'fb_exchange_token',client_id:c.appId,client_secret:c.appSecret,fb_exchange_token:connection.accessToken}).toString();token=await json(endpoint,{method:'GET'})
  }else{
   if(!connection.refreshToken)throw new Error('Fresh authorization required')
   if(platform==='linkedin')token=await json('https://www.linkedin.com/oauth/v2/accessToken',form({grant_type:'refresh_token',refresh_token:connection.refreshToken,client_id:c.appId,client_secret:c.appSecret}))
   else if(platform==='tiktok')token=await json('https://open.tiktokapis.com/v2/oauth/token/',form({grant_type:'refresh_token',refresh_token:connection.refreshToken,client_key:c.appId,client_secret:c.appSecret}))
   else token=await json('https://api.x.com/2/oauth2/token',form({grant_type:'refresh_token',refresh_token:connection.refreshToken,client_id:c.appId},{Authorization:`Basic ${Buffer.from(`${encodeURIComponent(c.appId)}:${encodeURIComponent(c.appSecret)}`).toString('base64')}`}))
   // RFC 6749 section 6: a returned refresh token replaces the prior one; omission keeps it.
   if(token.refresh_token===undefined){refreshOmitted=true;token={...token,refresh_token:connection.refreshToken}}
  }
  const result=await observeSocialGrant(platform,token,startedAt)
  if(result.status!=='observed')return result
  const accounts=result.accounts.filter(account=>account.accountId===connection.accountId).map(account=>({...account,refreshExpiresAt:account.refreshExpiresAt??(refreshOmitted?connection.refreshExpiresAt??null:null)}))
  if(accounts.length!==1)return{status:'uncertain',observedAt,accounts:[],reason:'The renewed account does not match the saved destination. Start fresh authorization.',tokenReceipt:{accessTokenEncrypted:encryptSecret(String(token.access_token)),refreshTokenEncrypted:typeof token.refresh_token==='string'?encryptSecret(token.refresh_token):null,expiresAt:expiry(token.expires_in??token.expires,startedAt),scopes:scopes(token.scope)}}
  return{...result,accounts}
 }catch{return{status:'uncertain',observedAt,accounts:[],reason:'The renewal result is unconfirmed. Start fresh authorization instead of repeating the exchange.'}}
}
