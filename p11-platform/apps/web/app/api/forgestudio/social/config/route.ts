import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyManagerAccess} from '@/utils/services/auth-guard'
import {CONFIG_PLATFORMS,socialCredentialStorageReady,encryptSecret,secretFingerprint,socialRpc} from '@/utils/forgestudio/social-security'
import {hasEnvironmentSocialConfig} from '@/utils/forgestudio/social-config'
import {ContentStoreError} from '@/utils/forgestudio/content-store'
const scope=z.object({propertyId:z.string().uuid(),platform:z.enum(CONFIG_PLATFORMS).default('meta')})
const write=scope.extend({requestId:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),action:z.enum(['save','disable']),appId:z.string().trim().min(1).max(256).optional(),appSecret:z.string().min(1).max(4096).optional()}).strict().refine(v=>v.action==='disable'||!!v.appId&&!!v.appSecret)
export async function GET(request:NextRequest){
 try{
  const {data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const query=new URL(request.url).searchParams,p=scope.safeParse({propertyId:query.get('propertyId'),platform:query.get('platform')??'meta'});if(!p.success)return NextResponse.json({error:'Invalid request'},{status:400})
  const access=await validatePropertyManagerAccess(user.id,p.data.propertyId);if(!access.authorized)return NextResponse.json({error:access.error||'Forbidden'},{status:403})
  const {data,error:readError}=await createServiceClient().from('social_auth_configs').select('id,platform,app_id,is_configured,configuration_version').eq('property_id',p.data.propertyId).eq('platform',p.data.platform).maybeSingle();if(readError)throw new Error('App setup could not be loaded')
  const env=hasEnvironmentSocialConfig(p.data.platform)
  return NextResponse.json({credentialStorageAvailable:socialCredentialStorageReady(),hasConfig:data?data.is_configured===true:env,disabled:data?.is_configured===false,version:data?.configuration_version??0,configSource:data?'database':env?'environment':null,config:data?{id:data.id,platform:data.platform,appId:data.app_id,isConfigured:data.is_configured}:null})
 }catch{return NextResponse.json({error:'Saved app setup could not be loaded. Reload before changing it.'},{status:503})}
}
export async function POST(request:NextRequest){
 try{
  const {data:{user},error}=await(await createClient()).auth.getUser();if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const p=write.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:'Invalid request'},{status:400})
  const {propertyId,platform,requestId,expectedVersion,action,appId,appSecret}=p.data,access=await validatePropertyManagerAccess(user.id,propertyId);if(!access.authorized)return NextResponse.json({error:access.error||'Forbidden'},{status:403})
  if(action==='save'&&!socialCredentialStorageReady())return NextResponse.json({error:'Secure credential storage is not configured on this server. App credentials cannot be saved yet.'},{status:503})
  const payload={platform,expectedVersion,action,...(action==='save'?{appId,secretFingerprint:secretFingerprint(appSecret)}:{})}
  return NextResponse.json(await socialRpc('save_forgestudio_social_config',{p_id:requestId,p_property_id:propertyId,p_actor_id:user.id,p_payload:payload,p_encrypted_secret:action==='save'?encryptSecret(appSecret!):null},['saved','replayed']))
 }catch(error){return NextResponse.json({error:error instanceof ContentStoreError?error.message:'The app setup save could not be confirmed. Retry the same decision.'},{status:error instanceof ContentStoreError?error.statusCode:503})}
}
export async function DELETE(){return NextResponse.json({error:'Reload app setup and use the versioned disable decision.'},{status:409})}
