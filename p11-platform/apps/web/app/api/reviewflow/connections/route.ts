import {NextRequest,NextResponse} from 'next/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {requireReviewOperator,loadProfileRole,isManagerRole,reviewError} from '@/utils/reviewflow/access'
import {ReviewStoreError} from '@/utils/reviewflow/analysis-store'
import {responseRpc} from '@/utils/reviewflow/response-store'
import {connectionReadSchema,connectionWriteSchema,reviewSourceUrl} from '@/utils/reviewflow/connection-contracts'
export async function GET(request:NextRequest){try{
 const parsed=connectionReadSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));if(!parsed.success)throw new ReviewStoreError('Choose a property for review sources.',400)
 const {propertyId,connectionId,cursor}=parsed.data,actor=await requireReviewOperator(propertyId),db=createServiceClient()
 const organization=await db.from('properties').select('org_id').eq('id',propertyId).single();if(organization.error||!organization.data?.org_id)throw new Error('Property unavailable')
 let rows=db.from('review_platform_connections').select('id,property_id,platform,version,place_id,google_maps_url,yelp_business_id,yelp_business_url,connection_type,sync_frequency,is_active,last_sync_at,total_reviews_synced,error_count,created_at').eq('property_id',propertyId).eq('org_id',organization.data.org_id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(101)
 if(connectionId)rows=rows.eq('id',connectionId)
 let history=db.from('reviewflow_connection_revisions').select('id,connection_id,version,before_state,after_state,reason,created_at').eq('property_id',propertyId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31)
 if(connectionId)history=history.eq('connection_id',connectionId)
 if(cursor){let anchorQuery=db.from('reviewflow_connection_revisions').select('id,created_at').eq('id',cursor).eq('property_id',propertyId);if(connectionId)anchorQuery=anchorQuery.eq('connection_id',connectionId);const anchor=await anchorQuery.maybeSingle();if(anchor.error)throw anchor.error;if(!anchor.data)throw new ReviewStoreError('Reload source history before paging.',409);history=history.or(`created_at.lt.${anchor.data.created_at},and(created_at.eq.${anchor.data.created_at},id.lt.${anchor.data.id})`)}
 const [connections,revisions,role]=await Promise.all([rows,history,loadProfileRole(actor)]);if(connections.error||revisions.error)throw new Error('Review source workspace unavailable');if(connections.data.length>100)throw new ReviewStoreError('This property has more source records than this workspace supports. Contact support before changing them.',409)
 return NextResponse.json({connections:connections.data.map(c=>({id:c.id,propertyId:c.property_id,platform:c.platform,version:c.version,providerId:(c.platform==='google'?c.place_id:c.yelp_business_id)||'',sourceUrl:reviewSourceUrl(c.platform,(c.platform==='google'?c.google_maps_url:c.yelp_business_url)||'')?((c.platform==='google'?c.google_maps_url:c.yelp_business_url)||''):'',method:c.connection_type||'api',frequency:c.sync_frequency||'manual',active:c.is_active===true,lastSyncAt:c.last_sync_at,reviewCount:c.total_reviews_synced||0,needsReview:(c.error_count||0)>0,supported:['google','yelp'].includes(c.platform),directReplyAvailable:false})),revisions:revisions.data.slice(0,30),nextCursor:revisions.data.length>30?revisions.data[29].id:null,canManage:isManagerRole(role),externalExecutionPaused:process.env.OUTBOUND_DELIVERY_PAUSED==='true'})
}catch(error){return reviewError(error)}}
export async function POST(request:NextRequest){try{
 const parsed=connectionWriteSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new ReviewStoreError('Review the supported source, current version, destination and reason.',400)
 const {propertyId,requestId,...input}=parsed.data,actor=await requireReviewOperator(propertyId)
 if(!isManagerRole(await loadProfileRole(actor)))throw new ReviewStoreError('A manager or admin must review source changes.',403)
 return NextResponse.json({result:await responseRpc('decide_reviewflow_connection',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input})})
}catch(error){return reviewError(error)}}
export const PATCH=POST
export async function DELETE(){return NextResponse.json({error:'Disconnect the saved source with its current version and a reason. Its reviews and history are retained.'},{status:405})}
