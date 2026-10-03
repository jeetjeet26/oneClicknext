import {createHmac} from 'node:crypto'
import {decryptSecret,encryptSecret} from './crypto'
import {createServiceClient} from '@/utils/supabase/admin'
import {ContentStoreError} from './content-store'
export const SOCIAL_PLATFORMS=['instagram','facebook','linkedin','tiktok','x'] as const
export type SocialPlatform=typeof SOCIAL_PLATFORMS[number]
export const CONFIG_PLATFORMS=['meta','linkedin','tiktok','x'] as const
export const REQUESTED_SCOPES:Record<SocialPlatform,string[]>={
 instagram:['instagram_basic','instagram_content_publish','pages_show_list','pages_read_engagement'],
 facebook:['pages_show_list','pages_read_engagement','pages_manage_posts'],
 linkedin:['openid','profile','w_member_social'],tiktok:['user.info.basic','video.publish'],x:['tweet.read','tweet.write','users.read','offline.access','media.write'],
}
export function socialCredentialStorageReady(){const key=process.env.ENCRYPTION_KEY;return !!key?.trim()&&key!=='p11-platform-default-key-change-me'}
export function secretFingerprint(value:unknown){
 // Enforce the same real key requirement as token encryption without exposing it.
 const key=process.env.ENCRYPTION_KEY;if(!key?.trim()||key==='p11-platform-default-key-change-me')throw new Error('Server encryption key is not configured')
 return createHmac('sha256',key).update('forgestudio-security-v1:').update(JSON.stringify(value)).digest('hex')
}
export async function socialRpc(name:string,args:Record<string,unknown>,accepted?:string[]){
 const db=createServiceClient() as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
 const {data,error}=await db.rpc(name,args);if(error||!data)throw new ContentStoreError('The connection decision could not be confirmed. Reload the saved state before continuing.',503)
 if(accepted&&!accepted.includes(String(data.state)))throw new ContentStoreError(({reauthorization_required:'Start fresh authorization to restore this account. No renewal exchange was attempted.',app_authorization_changed:'The provider app or original consent changed. Authorize this account again.',publication_in_progress:'A publication has already started. Check its result before renewing access.',forbidden:'Your current access does not allow this connection decision.',stale_configuration:'The app setup changed. Reload it before saving.',stale_connection:'This account changed. Reload it before disconnecting.',already_disconnected:'This account is already disconnected. Reload its saved status.',stale_authorization:'This authorization changed. Reload it before deciding.',authorization_closed:'This authorization is closed. Start fresh consent if access is still needed.',authorization_context_changed:'The app or account changed after authorization started. Start fresh consent.',grant_review_required:'The saved grant is incomplete or expired. Start fresh authorization before connecting.',request_conflict:'This request differs from its saved decision. Reload the saved result.',not_found:'This connection request is unavailable.'} as Record<string,string>)[String(data.state)]||'The saved connection needs review.',data.state==='forbidden'?403:409)
 return data
}
export {encryptSecret,decryptSecret}
