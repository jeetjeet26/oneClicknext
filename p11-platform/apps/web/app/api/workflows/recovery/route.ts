import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {actionHistoryDb} from '@/utils/actions/history'
import {readLeadDeliveryHistory,DeliveryHistoryError}from '@/utils/services/delivery-history'

const review=z.object({leadId:z.string().uuid(),deliveryId:z.string().uuid(),requestId:z.string().uuid(),resolution:z.enum(['accepted','not_sent','skip']),reason:z.string().trim().min(1).max(2000),providerId:z.string().trim().min(1).max(300).optional()}).superRefine((v,c)=>{if(v.resolution==='accepted'&&!v.providerId)c.addIssue({code:'custom',message:'Enter the provider message ID.'})})
async function authorize(leadId:string) {
 const auth=await createClient();const {data:{user}}=await auth.auth.getUser()
 if(!user)return {response:NextResponse.json({error:'Unauthorized'},{status:401})}
 const db=createServiceClient();const lead=await db.from('leads').select('property_id').eq('id',leadId).maybeSingle()
 if(lead.error)throw new Error('Lead could not be loaded')
 if(!lead.data?.property_id)return {response:NextResponse.json({error:'Lead not found'},{status:404})}
 if(!(await validatePropertyAccess(user.id,lead.data.property_id)).authorized)return {response:NextResponse.json({error:'Forbidden'},{status:403})}
 return {db,user,propertyId:lead.data.property_id}
}
export async function GET(request:NextRequest) {
 try {
  const lead=z.string().uuid().safeParse(request.nextUrl.searchParams.get('leadId'))
  if(!lead.success)return NextResponse.json({error:'A valid lead is required'},{status:400})
  const access=await authorize(lead.data);if(access.response)return access.response
  return NextResponse.json(await readLeadDeliveryHistory({leadId:lead.data,propertyId:access.propertyId!,actorId:access.user!.id,kind:'workflow',cursor:request.nextUrl.searchParams.get('cursor')},access.db),{headers:{'Cache-Control':'private, no-store'}})
 } catch(error) {if(error instanceof DeliveryHistoryError)return NextResponse.json({error:error.message},{status:error.status});return NextResponse.json({error:'Follow-up history could not be loaded. Try again.'},{status:500})}
}
export async function POST(request:NextRequest) {
 try {
  const parsed=review.safeParse(await request.json().catch(()=>null))
  if(!parsed.success)return NextResponse.json({error:'Choose a review outcome, enter a reason and include the provider ID for accepted messages.'},{status:400})
  const v=parsed.data,access=await authorize(v.leadId);if(access.response)return access.response
  const saved=await actionHistoryDb(access.db!).rpc('review_recorded_workflow_delivery',{p_property_id:access.propertyId!,p_lead_id:v.leadId,p_delivery_id:v.deliveryId,p_actor_id:access.user!.id,p_request_id:v.requestId,p_input:{resolution:v.resolution,reason:v.reason,...(v.providerId?{providerId:v.providerId}:{})}})
  if(saved.error || !saved.data)throw new Error('Review save not confirmed')
  const result=saved.data as {state:string;deliveryState?:string}
  if(['applied','replayed'].includes(result.state))return NextResponse.json(result)
  const messages:Record<string,string>={busy:'A send is still in progress. Wait for it to finish.',evidence_required:'Check the provider outcome before stopping an uncertain send.',conflict:'This follow-up changed. Refresh its history.',not_attempted:'No send attempt was recorded. It cannot be marked accepted.',request_conflict:'This request was used for another review. Refresh its history.',forbidden:'Forbidden',not_found:'Follow-up not found'}
  return NextResponse.json({error:messages[result.state] || 'Review could not be saved.'},{status:result.state==='forbidden'?403:result.state==='not_found'?404:409})
 } catch {return NextResponse.json({error:'The review save is unconfirmed. Retry the same review safely.'},{status:500})}
}
