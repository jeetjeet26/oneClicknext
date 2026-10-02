import {requireTeamOrigin} from '@/utils/team/http'
import {InventoryError} from '@/utils/knowledge/inventory'
import {NextRequest,NextResponse} from 'next/server'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {adminLimiter,getRateLimitKey,rateLimitHeaders} from '@/utils/services/rate-limiter'
import {validateBody,adminConfigInitializeSchema,adminConfigUpdateSchema} from '@/utils/services/validation'
import {actionHistoryDb} from '@/utils/actions/history'
import {createRequestContext} from '@/utils/services/request-context'
import {z} from 'zod'
import type {Json} from '@/types/supabase'

const messages:Record<string,string>={
 stale_configuration:'These settings changed elsewhere. Load the latest settings before saving again.',
 request_conflict:'This request belongs to another change. Load the latest settings before trying again.',
 already_configured:'The assistant was already initialized. Load its current settings.',
 not_configured:'Initialize the assistant before changing its settings.',
 legacy_timezone_review:'Some existing tours have no saved timezone. Review those tours before changing the property timezone.',
 invalid_timezone:'Choose a valid property timezone.',invalid_hours:'Check the opening and closing times.',
 invalid_configuration:'Check the configuration values before saving.',forbidden:'A property manager or administrator must save widget settings.',
}
async function handle(request:NextRequest,operation:'read'|'initialize'|'save'){
 const ctx=createRequestContext(request,'/api/lumaleasing/admin/config');ctx.logStart()
 const headers={...ctx.responseHeaders,'Cache-Control':'no-store'}
 try{
  if(operation!=='read')requireTeamOrigin(request)
  const limit=adminLimiter.check(getRateLimitKey(request,'admin-config'))
  if(!limit.allowed)return NextResponse.json({error:'Too many requests'},{status:429,headers:{...headers,...rateLimitHeaders(limit)}})
  const auth=await createClient();const {data:{user},error:authError}=await auth.auth.getUser()
  if(authError||!user)return NextResponse.json({error:'Unauthorized'},{status:401,headers})
  const body=operation==='read'?null:await request.json().catch(()=>null)
  const validation=operation==='save'?validateBody(body,adminConfigUpdateSchema):operation==='initialize'?validateBody(body,adminConfigInitializeSchema):null
  if(validation&&!validation.success)return NextResponse.json({error:validation.error},{status:400,headers})
  const input=validation?.success?validation.data:null
  const propertyId=input?.propertyId||new URL(request.url).searchParams.get('propertyId')
  if(!z.string().regex(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i).safeParse(propertyId).success)return NextResponse.json({error:'A valid property is required'},{status:400,headers})
  if(!(await validatePropertyAccess(user.id,propertyId!)).authorized)return NextResponse.json({error:'Forbidden'},{status:403,headers})
  const db=actionHistoryDb(createServiceClient())
  const saved=operation==='read'?await db.rpc('read_luma_configuration',{p_property_id:propertyId!}):await db.rpc('save_recorded_luma_configuration',{
   p_property_id:propertyId!,p_actor_id:user.id,p_request_id:input!.requestId,p_operation:operation,p_config:input&&'config' in input?input.config as Json:{},p_expected_revision:input!.expectedRevision,
  })
  if(saved.error||!saved.data||typeof saved.data!=='object'||Array.isArray(saved.data))throw new Error('Configuration result could not be confirmed')
  const result=saved.data
  const {data:profile,error:profileError}=await db.from('profiles').select('role').eq('id',user.id).single()
  if(profileError||!profile)throw new Error('Current configuration access could not be confirmed')
  const canManage=['admin','manager'].includes(profile.role||'')
  if(operation!=='read'&&!['applied','replayed'].includes(String(result.state))){
   return NextResponse.json({error:messages[String(result.state)]||'Configuration could not be saved.',code:result.state,actionEventId:result.actionEventId},{status:result.state==='forbidden'?403:409,headers})
  }
  if(typeof result.revision!=='string'||(operation!=='read'&&(!result.config||!result.actionEventId)))throw new Error('Configuration acknowledgement is incomplete')
  ctx.logSuccess(200,{propertyId,operation,state:result.state})
  return NextResponse.json({...result,canManage},{headers})
 }catch(error){
  if(error instanceof InventoryError)return NextResponse.json({error:error.message},{status:error.status,headers})
  ctx.logError(500,error,{operation})
  return NextResponse.json({error:operation==='read'?'Configuration is unavailable. Retry to load saved settings.':'The save is unconfirmed. Retry the same change safely.'},{status:503,headers})
 }
}
export const GET=(request:NextRequest)=>handle(request,'read')
export const POST=(request:NextRequest)=>handle(request,'initialize')
export const PUT=(request:NextRequest)=>handle(request,'save')
