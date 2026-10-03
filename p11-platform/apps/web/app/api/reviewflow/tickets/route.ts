import {NextRequest,NextResponse} from 'next/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {ticketReadSchema} from '@/utils/reviewflow/case-contracts'
import {requireReviewOperator,reviewError} from '@/utils/reviewflow/access'
import {ReviewStoreError} from '@/utils/reviewflow/analysis-store'
import {PATCH as decideCase} from '../cases/route'
export async function GET(request:NextRequest){try{
 const parsed=ticketReadSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));if(!parsed.success)throw new ReviewStoreError('Choose a property and valid ticket filters.',400)
 const p=parsed.data;await requireReviewOperator(p.propertyId);const db=createServiceClient();const property=await db.from('properties').select('org_id').eq('id',p.propertyId).single();if(property.error||!property.data.org_id)throw new ReviewStoreError('Property organization unavailable.',409)
 let query=db.from('review_tickets').select('*,reviews(id,property_id,reviewer_name,rating,review_text,sentiment,platform,review_date),assigned_user:profiles!review_tickets_assigned_to_fkey(id,full_name,org_id)').eq('property_id',p.propertyId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(p.limit+1)
 if(p.reviewId)query=query.eq('review_id',p.reviewId);if(p.status)query=query.eq('status',p.status);if(p.priority)query=query.eq('priority',p.priority);if(p.assignedTo)query=query.eq('assigned_to',p.assignedTo)
 if(p.cursor){let anchorQuery=db.from('review_tickets').select('id,created_at').eq('id',p.cursor).eq('property_id',p.propertyId);if(p.reviewId)anchorQuery=anchorQuery.eq('review_id',p.reviewId);if(p.status)anchorQuery=anchorQuery.eq('status',p.status);if(p.priority)anchorQuery=anchorQuery.eq('priority',p.priority);if(p.assignedTo)anchorQuery=anchorQuery.eq('assigned_to',p.assignedTo);const anchor=await anchorQuery.maybeSingle();if(anchor.error)throw anchor.error;if(!anchor.data)throw new ReviewStoreError('Reload these ticket filters before paging.',409);query=query.or(`created_at.lt.${anchor.data.created_at},and(created_at.eq.${anchor.data.created_at},id.lt.${anchor.data.id})`)}
 const rows=await query;if(rows.error)throw rows.error;return NextResponse.json({tickets:rows.data.slice(0,p.limit).map(t=>({...t,reviews:t.reviews?.property_id===p.propertyId?{id:t.reviews.id,reviewer_name:t.reviews.reviewer_name,rating:t.reviews.rating,review_text:t.reviews.review_text,sentiment:t.reviews.sentiment,platform:t.reviews.platform,review_date:t.reviews.review_date}:null,assigned_user:t.assigned_user?.org_id===property.data.org_id?{id:t.assigned_user.id,full_name:t.assigned_user.full_name}:null})),nextCursor:rows.data.length>p.limit?rows.data[p.limit-1].id:null})
}catch(error){return reviewError(error)}}
export async function POST(request:NextRequest){return decideCase(request)}
export async function PATCH(request:NextRequest){return decideCase(request)}
export async function DELETE(){return NextResponse.json({error:'Ticket history is retained. Open the case to record a closure or reopening.'},{status:405})}
