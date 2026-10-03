import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {actionHistoryDb} from '@/utils/actions/history'
const schema=z.object({leadId:z.string().uuid().optional(),propertyId:z.string().uuid().optional(),requestId:z.string().uuid(),timezone:z.string().min(1).max(80)}).refine(input=>Boolean(input.leadId)!==Boolean(input.propertyId))
export async function POST(request:NextRequest) {
 try {
  const auth=await createClient();const {data:{user},error}=await auth.auth.getUser()
  if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const input=schema.safeParse(await request.json().catch(()=>null));if(!input.success)return NextResponse.json({error:'Choose a timezone and provide a valid request.'},{status:400})
  const db=createServiceClient()
  let propertyId=input.data.propertyId
  if(input.data.leadId){
   const lead=await db.from('leads').select('property_id').eq('id',input.data.leadId).maybeSingle()
   if(lead.error)throw new Error('Lead could not be loaded')
   if(!lead.data?.property_id)return NextResponse.json({error:'Lead not found'},{status:404})
   propertyId=lead.data.property_id
  }
  if(!propertyId)return NextResponse.json({error:'Property not found'},{status:404})
  if(!(await validatePropertyAccess(user.id,propertyId)).authorized)return NextResponse.json({error:'Forbidden'},{status:403})
  const saved=await actionHistoryDb(db).rpc('set_recorded_tour_timezone',{p_property_id:propertyId,p_actor_id:user.id,p_request_id:input.data.requestId,p_timezone:input.data.timezone})
  if(saved.error||!saved.data)throw new Error('Save unconfirmed')
  const result=saved.data as {state:string}
  if(['applied','replayed','already_configured'].includes(result.state))return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}})
  return NextResponse.json({error:result.state==='invalid_timezone'?'Choose a valid timezone.':result.state==='request_conflict'?'This request was used for another change. Reload this page before making another change.':'Forbidden'},{status:result.state==='forbidden'?403:409})
 }catch{return NextResponse.json({error:'The timezone save is unconfirmed. Retry the same selection safely.'},{status:500})}
}
