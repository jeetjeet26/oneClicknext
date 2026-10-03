import {NextRequest,NextResponse} from 'next/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {requireReviewOperator,loadProfileRole,isManagerRole,reviewError} from '@/utils/reviewflow/access'
import {ReviewStoreError} from '@/utils/reviewflow/analysis-store'
import {responseRpc} from '@/utils/reviewflow/response-store'
import {configurationReadSchema,configurationWriteSchema} from '@/utils/reviewflow/configuration-contracts'
export async function GET(request:NextRequest){try{
 const parsed=configurationReadSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));if(!parsed.success)throw new ReviewStoreError('Choose a property for review preferences.',400)
 const {propertyId,cursor}=parsed.data,actor=await requireReviewOperator(propertyId),db=createServiceClient()
 let history=db.from('reviewflow_configuration_revisions').select('id,version,before_state,after_state,reason,created_at').eq('property_id',propertyId).order('version',{ascending:false}).limit(31)
 if(cursor){const anchor=await db.from('reviewflow_configuration_revisions').select('version').eq('id',cursor).eq('property_id',propertyId).maybeSingle();if(anchor.error)throw anchor.error;if(!anchor.data)throw new ReviewStoreError('Reload preference history before paging.',409);history=history.lt('version',anchor.data.version)}
 const [config,revisions,role]=await Promise.all([db.from('reviewflow_config').select('id,version,default_tone,property_personality').eq('property_id',propertyId).maybeSingle(),history,loadProfileRole(actor)])
 if(config.error||revisions.error)throw new Error('Saved preferences unavailable')
 return NextResponse.json({config:config.data??{id:null,version:0,default_tone:'professional',property_personality:null},revisions:revisions.data.slice(0,30),nextCursor:revisions.data.length>30?revisions.data[29].id:null,canManage:isManagerRole(role)})
}catch(error){return reviewError(error)}}
export async function POST(request:NextRequest){try{
 const parsed=configurationWriteSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new ReviewStoreError('Review the supported response preferences and provide a reason.',400)
 const {propertyId,requestId,...input}=parsed.data,actor=await requireReviewOperator(propertyId)
 if(!isManagerRole(await loadProfileRole(actor)))throw new ReviewStoreError('A manager or admin must review these preferences.',403)
 const result=await responseRpc('decide_reviewflow_configuration',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input})
 return NextResponse.json({result})
}catch(error){return reviewError(error)}}
export const PATCH=POST
