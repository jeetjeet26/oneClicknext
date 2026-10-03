import {createServiceClient} from '@/utils/supabase/admin'
import {getSiteUrl} from './oauth-flow'
import {getSocialAppCredentials} from './social-config'
import {socialRpc,secretFingerprint,encryptSecret,decryptSecret,socialCredentialStorageReady,type SocialPlatform} from './social-security'
import {renewSocialAuthorization} from './oauth-provider'
import {ContentStoreError} from './content-store'
export type RenewalInput={propertyId:string;requestId:string;connectionId:string;expectedVersion:number;reason:string}
export async function renewSocialConnection(input:RenewalInput,actorId:string){
 const db=createServiceClient(),{propertyId,requestId,...payload}=input
 const prior=await db.from('forgestudio_renewals').select('id').eq('id',requestId).eq('property_id',propertyId).maybeSingle();if(prior.error)throw new ContentStoreError('Saved access renewal could not be loaded. Reload its history.',503)
 const base={p_id:requestId,p_property_id:propertyId,p_actor_id:actorId,p_payload:payload}
 // A completed or ambiguous request can be read even after app credentials change or delivery pauses.
 if(prior.data)return socialRpc('begin_forgestudio_renewal',{...base,p_credential_fingerprint:'replay',p_credentials:{}},['completed','held','exchanging'])
 if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')throw new ContentStoreError('External access renewal is paused in this environment.',503)
 if(!socialCredentialStorageReady())throw new ContentStoreError('Secure credential storage is not configured on this server.',503)
 const {data:connection,error}=await db.from('social_connections').select('id,platform').eq('id',input.connectionId).eq('property_id',propertyId).maybeSingle();if(error)throw new ContentStoreError('The saved account could not be loaded.',503);if(!connection)throw new ContentStoreError('The saved account is unavailable.',404)
 const platform=connection.platform as SocialPlatform,c=await getSocialAppCredentials(propertyId,platform==='facebook'||platform==='instagram'?'meta':platform);if(!c)throw new ContentStoreError('Configure this provider app and authorize the account again.',409)
 const redirectUri=new URL(`/api/forgestudio/social/callback/${platform}`,getSiteUrl()).toString(),credentialFingerprint=secretFingerprint({platform,appId:c.appId,appSecret:c.appSecret,redirectUri})
 const claimed=await socialRpc('begin_forgestudio_renewal',{...base,p_credential_fingerprint:credentialFingerprint,p_credentials:{appId:c.appId,appSecretEncrypted:encryptSecret(c.appSecret),redirectUri}},['exchange_once','exchanging','completed','held'])
 if(claimed.state!=='exchange_once')return claimed
 const saved=claimed.credentials as Record<string,string|null>
 const result=await renewSocialAuthorization(platform,{appId:saved.appId!,appSecret:decryptSecret(saved.appSecretEncrypted!),redirectUri:saved.redirectUri!},{accountId:saved.accountId!,accessToken:saved.accessTokenEncrypted?decryptSecret(saved.accessTokenEncrypted):null,refreshToken:saved.refreshTokenEncrypted?decryptSecret(saved.refreshTokenEncrypted):null,refreshExpiresAt:saved.refreshExpiresAt??null})
 const args={p_id:requestId,p_claim_token:claimed.claimToken,p_result:result}
 // Retry identical private result persistence only; never repeat the provider exchange.
 let finished:Record<string,unknown>
 try{finished=await socialRpc('finish_forgestudio_renewal',args,['saved','replayed'])}catch{finished=await socialRpc('finish_forgestudio_renewal',args,['saved','replayed'])}
 return{...finished,renewalId:requestId,connectionId:input.connectionId}
}
