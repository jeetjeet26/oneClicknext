import {NextRequest,NextResponse} from 'next/server'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {calendarBindingSchema,bindCalendarEvent,bindingMessages} from '@/utils/services/tour-calendar-binding'
const headers={'Cache-Control':'no-store'}
export async function POST(request:NextRequest){
 const parsed=calendarBindingSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Invalid calendar selection.'},{status:400,headers})
 const {data:{user},error}=await (await createClient()).auth.getUser();if(error||!user)return NextResponse.json({error:'Sign in to link a calendar event.'},{status:401,headers})
 if(!(await validatePropertyAccess(user.id,parsed.data.propertyId)).authorized)return NextResponse.json({error:'You do not have access to this property.'},{status:403,headers})
 try{const r=await bindCalendarEvent(createServiceClient(),user.id,parsed.data);if(['listed','applied','replayed'].includes(r.state))return NextResponse.json(r,{headers});return NextResponse.json({...r,error:bindingMessages[r.state]||'Calendar selection could not be confirmed. Retry the same selection.'},{status:r.state==='not_found'?404:r.state==='forbidden'?403:409,headers})}
 catch{return NextResponse.json({error:'Calendar lookup or save could not be confirmed. Retry the same selection.'},{status:503,headers})}
}
