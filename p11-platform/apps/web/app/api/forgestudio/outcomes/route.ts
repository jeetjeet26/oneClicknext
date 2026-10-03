import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {ContentStoreError} from '@/utils/forgestudio/content-store'
import {measurementRpc,requestPublicationMetrics} from '@/utils/forgestudio/engagement-sync'
const uuid=z.string().uuid(),stamp=z.string().datetime({offset:true}),count=z.number().int().min(0).max(1_000_000_000_000).nullable().optional()
const metrics=z.object({impressions:count,reach:count,clicks:count,reactions:count,comments:count,shares:count,saves:count,video_views:count,video_completions:count}).strict()
const base=z.object({requestId:uuid,propertyId:uuid,publicationId:uuid})
const requestSchema=z.discriminatedUnion('action',[base.extend({action:z.literal('request')}),base.extend({action:z.literal('report'),metrics,observedAt:stamp,source:z.string().trim().min(3).max(2000),reason:z.string().trim().min(3).max(2000)})])
const reviewBase=z.object({requestId:uuid,propertyId:uuid,expectedVersion:z.number().int().positive(),reason:z.string().trim().min(3).max(2000)})
const reviewSchema=z.discriminatedUnion('action',[reviewBase.extend({action:z.literal('review_metrics'),measurementId:uuid,decision:z.enum(['included','excluded'])}),reviewBase.extend({action:z.literal('review_attribution'),eventId:uuid,decision:z.enum(['active','excluded'])})])
function failure(error:unknown){return NextResponse.json({error:error instanceof ContentStoreError?error.message:'Saved outcome evidence could not be loaded. Reload to try again.'},{status:error instanceof ContentStoreError?error.statusCode:503})}
async function user(){const {data:{user}}=await(await createClient()).auth.getUser();return user}
function pageCursor(value:string|null){if(!value)return null;const [time,id,...rest]=value.split('|');if(rest.length||!stamp.safeParse(time).success||!uuid.safeParse(id).success)throw new ContentStoreError('Invalid results page',400);return {time,id}}
export async function GET(request:NextRequest){
 const actor=await user();if(!actor)return NextResponse.json({error:'Unauthorized'},{status:401})
 const params=new URL(request.url).searchParams,property=uuid.safeParse(params.get('propertyId'))
 if(!property.success)return NextResponse.json({error:'Valid property required'},{status:400})
 const access=await validatePropertyAccess(actor.id,property.data);if(!access.authorized||!access.orgId)return NextResponse.json({error:'Forbidden'},{status:403})
 try{
  const db=createServiceClient(),mode=params.get('mode')||'publications',cursor=pageCursor(params.get('cursor'))
  if(mode==='publications'){
   let query=db.from('social_publications').select('id,platform,remote_post_url,remote_post_id,published_at,revision_id,delivery_snapshot,social_content_variants(caption),social_content_packages(concept_summary)').eq('property_id',property.data).eq('org_id',access.orgId).eq('status','published').not('published_at','is',null)
   if(cursor)query=query.or(`published_at.lt.${cursor.time},and(published_at.eq.${cursor.time},id.lt.${cursor.id})`)
   const {data,error}=await query.order('published_at',{ascending:false}).order('id',{ascending:false}).limit(31);if(error)throw error;const rows=(data??[]).slice(0,30),last=rows.at(-1)
   return NextResponse.json({publications:rows.map(row=>({id:row.id,platform:row.platform,remotePostUrl:row.remote_post_url,publishedAt:row.published_at,revisionId:row.revision_id,title:row.social_content_packages?.concept_summary||row.social_content_variants?.caption||'Published campaign',legacy:!row.delivery_snapshot})),nextCursor:(data?.length??0)>30&&last?`${last.published_at}|${last.id}`:null,paused:process.env.OUTBOUND_DELIVERY_PAUSED==='true'})
  }
  const publicationId=uuid.safeParse(params.get('publicationId'));if(!publicationId.success)throw new ContentStoreError('Choose a published post',400)
  const {data:publication,error:publicationError}=await db.from('social_publications').select('id,published_at').eq('id',publicationId.data).eq('property_id',property.data).eq('org_id',access.orgId).eq('status','published').single();if(publicationError||!publication)throw new ContentStoreError('Published post unavailable',404)
  if(mode==='measurements'){
   let query=db.from('forgestudio_measurements').select('id,origin,state,snapshot,result,error_code,review_status,review_version,created_at,updated_at').eq('publication_id',publication.id).eq('property_id',property.data).eq('org_id',access.orgId)
   if(cursor)query=query.or(`created_at.lt.${cursor.time},and(created_at.eq.${cursor.time},id.lt.${cursor.id})`)
   const [{data,error},legacy]=await Promise.all([query.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31),db.from('social_publication_metrics').select('id',{count:'exact',head:true}).eq('publication_id',publication.id).eq('property_id',property.data)])
   if(error||legacy.error)throw error||legacy.error;const rows=(data??[]).slice(0,30),last=rows.at(-1)
   const measurements=rows.map(row=>{const result=row.result as {metrics?:Record<string,number|null>;observedAt?:string;definition?:string;source?:string;reason?:string}|null,snapshot=row.snapshot as {publication?:{remotePostId?:string;revisionId?:string}};return {id:row.id,origin:row.origin,state:row.state,metrics:result?.metrics??null,observedAt:result?.observedAt??null,definition:result?.definition??null,source:row.origin==='operator_report'?result?.source:null,reason:row.origin==='operator_report'?result?.reason:null,errorCode:row.error_code,reviewStatus:row.review_status,reviewVersion:row.review_version,remotePostId:snapshot.publication?.remotePostId,revisionId:snapshot.publication?.revisionId,createdAt:row.created_at}})
   return NextResponse.json({measurements,legacyCount:legacy.count??0,nextCursor:(data?.length??0)>30&&last?`${last.created_at}|${last.id}`:null})
  }
  if(mode==='attribution'){
   let query=db.from('social_attribution_events').select('id,event_type,occurred_at,created_at,evidence_kind,source_system,event_state,decision_version').eq('publication_id',publication.id).eq('property_id',property.data).eq('org_id',access.orgId)
   if(cursor)query=query.or(`created_at.lt.${cursor.time},and(created_at.eq.${cursor.time},id.lt.${cursor.id})`)
   const {data,error}=await query.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31);if(error)throw error;const rows=(data??[]).slice(0,30),last=rows.at(-1)
   return NextResponse.json({events:rows,nextCursor:(data?.length??0)>30&&last?`${last.created_at}|${last.id}`:null})
  }
  throw new ContentStoreError('Unknown outcome view',400)
 }catch(error){return failure(error)}
}
export async function POST(request:NextRequest){
 const actor=await user();if(!actor)return NextResponse.json({error:'Unauthorized'},{status:401})
 const parsed=requestSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Check the source, observation time and whole-number counts.'},{status:400})
 const access=await validatePropertyAccess(actor.id,parsed.data.propertyId);if(!access.authorized||!access.orgId)return NextResponse.json({error:'Forbidden'},{status:403})
 try{const {requestId,propertyId,action,...payload}=parsed.data;const result=action==='request'?await requestPublicationMetrics({requestId,propertyId,publicationId:payload.publicationId,actorId:actor.id}):await measurementRpc('report_forgestudio_metrics',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor.id,p_payload:payload},['saved','replayed']);return NextResponse.json(result,{status:201})}catch(error){return failure(error)}
}
export async function PATCH(request:NextRequest){
 const actor=await user();if(!actor)return NextResponse.json({error:'Unauthorized'},{status:401})
 const parsed=reviewSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Reload the observation and explain this review decision.'},{status:400})
 const access=await validatePropertyAccess(actor.id,parsed.data.propertyId);if(!access.authorized||!access.orgId)return NextResponse.json({error:'Forbidden'},{status:403})
 try{const {requestId,propertyId,action,...payload}=parsed.data;return NextResponse.json(await measurementRpc(action==='review_metrics'?'review_forgestudio_measurement':'review_forgestudio_attribution',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor.id,p_payload:payload},['saved','replayed']))}catch(error){return failure(error)}
}
