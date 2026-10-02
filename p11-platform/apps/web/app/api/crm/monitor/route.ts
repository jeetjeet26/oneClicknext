import {NextRequest,NextResponse} from 'next/server'
import {createClient} from '@/utils/supabase/server'
import {crmRpc} from '@/utils/crm/workspace'
export async function GET(req:NextRequest){
 const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}})
 try{
  const client=await createClient(),{data:{user},error}=await client.auth.getUser();if(error||!user)return json({error:'Unauthorized'},401)
  const property=req.nextUrl.searchParams.get('propertyId');if(!property||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(property))return json({error:'A valid property is required.'},400)
  const result=await crmRpc('read_crm_monitor',{p_property_id:property,p_actor_id:user.id});if(result.state!=='saved')return json({error:'CRM history is unavailable for this property.'},result.state==='forbidden'?403:409)
  return json(result)
 }catch{return json({error:'CRM status could not be loaded. Reload to check saved results.'},503)}
}
