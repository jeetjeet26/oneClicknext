import {NextRequest,NextResponse} from 'next/server'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {calendarReviewSchema,reviewCalendarChange,calendarReviewErrors} from '@/utils/services/tour-calendar-review'
import {scheduleFailure} from '@/utils/services/tour-scheduling'
const headers={'Cache-Control':'no-store'}
export async function POST(request:NextRequest){
  const parsed=calendarReviewSchema.safeParse(await request.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:'Invalid calendar review.'},{status:400,headers})
  const auth=await createClient(),{data:{user},error}=await auth.auth.getUser()
  if(error||!user)return NextResponse.json({error:'Sign in to review calendar changes.'},{status:401,headers})
  const access=await validatePropertyAccess(user.id,parsed.data.propertyId)
  if(!access.authorized)return NextResponse.json({error:'You do not have access to this property.'},{status:403,headers})
  try{
    const result=await reviewCalendarChange(createServiceClient(),user.id,parsed.data)
    if(['applied','replayed','refreshed'].includes(result.state))return NextResponse.json(result,{headers})
    const failure=calendarReviewErrors[result.state]||scheduleFailure(result)||{status:503,error:'Calendar decision could not be confirmed. Retry the same decision.'}
    return NextResponse.json({...result,error:failure.error},{status:failure.status,headers})
  }catch{
    return NextResponse.json({error:'The calendar check or save could not be confirmed. Retry the same decision.'},{status:503,headers})
  }
}
