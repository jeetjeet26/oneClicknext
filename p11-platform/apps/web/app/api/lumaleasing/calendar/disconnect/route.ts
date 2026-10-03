import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {actionHistoryDb} from '@/utils/actions/history'
const schema=z.object({propertyId:z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),requestId:z.string().uuid(),provider:z.enum(['google','microsoft']).optional()}).strict()
const headers={'Cache-Control':'no-store'}
export async function POST(request:NextRequest){
 const input=schema.safeParse(await request.json().catch(()=>null))
 if(!input.success)return NextResponse.json({error:'Invalid disconnection request.'},{status:400,headers})
 try{
  const auth=await createClient(),{data:{user},error:authError}=await auth.auth.getUser()
  if(authError||!user)return NextResponse.json({error:'Sign in to disconnect this calendar.'},{status:401,headers})
  const access=await validatePropertyAccess(user.id,input.data.propertyId)
  if(!access.authorized)return NextResponse.json({error:'You do not have access to this property.'},{status:403,headers})
  const {data,error}=await actionHistoryDb(createServiceClient()).rpc('disconnect_recorded_calendar',{p_property_id:input.data.propertyId,p_actor_id:user.id,p_request_id:input.data.requestId,...(input.data.provider?{p_provider:input.data.provider}:{})})
  if(error||!data||typeof data!=='object'||Array.isArray(data))throw new Error('Unconfirmed')
  if(data.state==='request_conflict')return NextResponse.json({error:'This request belongs to another decision. Reload before continuing.'},{status:409,headers})
  if(data.state==='forbidden')return NextResponse.json({error:'You do not have access to this property.'},{status:403,headers})
  if(!['applied','replayed'].includes(String(data.state))||!data.actionEventId||typeof data.disconnected!=='number')throw new Error('Unconfirmed')
  return NextResponse.json({...data,success:true},{headers})
 }catch{return NextResponse.json({error:'Disconnection could not be confirmed. Retry the same request.'},{status:503,headers})}
}
