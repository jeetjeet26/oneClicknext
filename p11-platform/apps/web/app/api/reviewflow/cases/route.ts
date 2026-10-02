import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createServiceClient} from '@/utils/supabase/admin'
import {caseDecisionSchema,caseReadSchema} from '@/utils/reviewflow/case-contracts'
import {requireReviewOperator,reviewError} from '@/utils/reviewflow/access'
import {reviewRpc,ReviewStoreError} from '@/utils/reviewflow/analysis-store'

export async function GET(request:NextRequest){try{
 const params=Object.fromEntries(request.nextUrl.searchParams)
 if(params.view==='members'){
  const parsed=z.object({view:z.literal('members'),propertyId:z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),cursor:z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).optional()}).strict().safeParse(params);if(!parsed.success)throw new ReviewStoreError('Choose a property and saved team page.',400)
  await requireReviewOperator(parsed.data.propertyId);const db=createServiceClient();const {data:property,error}=await db.from('properties').select('org_id').eq('id',parsed.data.propertyId).single();if(error)throw error;if(!property.org_id)throw new ReviewStoreError('Property organization unavailable.',409)
  let query=db.from('profiles').select('id,full_name').eq('org_id',property.org_id).order('id').limit(101);if(parsed.data.cursor)query=query.gt('id',parsed.data.cursor);const team=await query;if(team.error)throw team.error
  return NextResponse.json({members:team.data.slice(0,100),nextCursor:team.data.length>100?team.data[99].id:null})
 }
 const parsed=caseReadSchema.safeParse(params);if(!parsed.success)throw new ReviewStoreError('Choose a saved review and property.',400)
 const {propertyId,reviewId,cursor}=parsed.data;await requireReviewOperator(propertyId);const db=createServiceClient()
 const source=await db.from('reviews').select('id,source_version').eq('id',reviewId).eq('property_id',propertyId).maybeSingle();if(source.error)throw source.error;if(!source.data)throw new ReviewStoreError('This review is unavailable.',404)
 const [caseResult,analysisResult]=await Promise.all([
  db.from('reputation_cases').select('*').eq('review_id',reviewId).eq('property_id',propertyId).maybeSingle(),
  db.from('review_analyses').select('*').eq('review_id',reviewId).eq('property_id',propertyId).eq('source_version',source.data.source_version).in('status',['completed','manual_review_required']).order('analysis_version',{ascending:false}).limit(1).maybeSingle()
 ]);if(caseResult.error||analysisResult.error)throw new Error('Case read failed')
 let events:Record<string,unknown>[]=[];let nextCursor:string|null=null
 if(caseResult.data){let query=db.from('reputation_case_events').select('id,event_type,actor_profile_id,actor_label,payload,created_at').eq('case_id',caseResult.data.id).eq('property_id',propertyId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31)
  if(cursor){const anchor=await db.from('reputation_case_events').select('id,created_at').eq('id',cursor).eq('case_id',caseResult.data.id).eq('property_id',propertyId).maybeSingle();if(anchor.error)throw anchor.error;if(!anchor.data)throw new ReviewStoreError('Reload this case history before paging.',409);query=query.or(`created_at.lt.${anchor.data.created_at},and(created_at.eq.${anchor.data.created_at},id.lt.${anchor.data.id})`)}
  const history=await query;if(history.error)throw history.error;events=history.data.slice(0,30);nextCursor=history.data.length>30?history.data[29].id:null
 }else if(cursor)throw new ReviewStoreError('This case history is unavailable.',409)
 return NextResponse.json({case:caseResult.data,analysis:analysisResult.data,events,nextCursor,sourceVersion:source.data.source_version})
}catch(error){return reviewError(error)}}
export async function PATCH(request:NextRequest){try{
 const parsed=caseDecisionSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new ReviewStoreError('Review the case, reason and required decision details.',400)
 const {propertyId,requestId,...input}=parsed.data,actor=await requireReviewOperator(propertyId)
 if(input.action==='ticket.update'&&['resolved','closed'].includes(input.status||'')&&(input.resolutionNotes?.trim().length||0)<3)throw new ReviewStoreError('Record the ticket resolution evidence.',400)
 const result=await reviewRpc('decide_reviewflow_case',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input})
 if(!['saved','replayed'].includes(String(result.state)))throw new ReviewStoreError(({stale_case:'This case changed. Reload before applying your decision.',stale_ticket:'This ticket changed. Reload its current state.',stale_source:'The review changed. Reload its current source.',case_closed:'Reopen this case before changing its work.',ticket_closed:'Use the explicit reopen decision for a closed ticket.',open_tickets:'Resolve or close the remaining tickets before closing this case.',assignee_unavailable:'The selected team member is no longer available.',case_exists:'A case already exists. Reload its current state.',already_open:'This work is already open.',request_conflict:'This request differs from its saved decision.',forbidden:'Your current access no longer allows this decision.'} as Record<string,string>)[String(result.state)]||'This case or ticket is unavailable.',result.state==='forbidden'?403:409)
 return NextResponse.json({result})
}catch(error){return reviewError(error)}}
export const POST=PATCH
