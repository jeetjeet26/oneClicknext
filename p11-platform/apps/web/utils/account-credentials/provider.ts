import {createClient} from '@supabase/supabase-js'
import {getSupabasePublishableKey,getSupabaseUrl} from '@/utils/supabase/config'
export async function verifyCurrentPassword(actor:string,email:string,password:string){
 const client=createClient(getSupabaseUrl(),getSupabasePublishableKey(),{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{'User-Agent':'P11 password verification'}}})
 let verified=false,cleanup:'confirmed'|'not_created'|'unconfirmed'='unconfirmed'
 try{
  const r=await client.auth.signInWithPassword({email,password})
  verified=!r.error&&r.data.user?.id===actor
  const token=r.data.session?.access_token
  if(token){try{cleanup=(await client.auth.admin.signOut(token,'local')).error?'unconfirmed':'confirmed'}catch{cleanup='unconfirmed'}}
  else if(r.error&&[400,401,403,422,429].includes(r.error.status||0))cleanup='not_created'
 }catch{cleanup='unconfirmed'}
 return {verified,cleanup}
}
