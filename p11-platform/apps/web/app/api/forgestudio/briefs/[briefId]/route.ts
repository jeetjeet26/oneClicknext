import {NextRequest,NextResponse} from 'next/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {requireMarketOperator,marketError} from '@/utils/marketvision/decision-store'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {z} from 'zod'
const id=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
export async function GET(req:NextRequest,{params}:{params:Promise<{briefId:string}>}){try{
 const {briefId}=await params,propertyId=req.nextUrl.searchParams.get('propertyId')??''
 const actor=await requireMarketOperator(propertyId)
 const access=await validatePropertyAccess(actor,propertyId)
 if(!access.authorized||!access.orgId)return NextResponse.json({error:'This property is unavailable to your account.'},{status:403})
 if(!id.safeParse(briefId).success||!id.safeParse(propertyId).success)return NextResponse.json({error:'Select a saved draft in this property.'},{status:400})
 const {data,error}=await createServiceClient().from('social_content_briefs').select('id,property_id,title,objective,topic,source_facts,constraints,channels,format_plan,status,created_at').eq('id',briefId).eq('property_id',propertyId).eq('org_id',access.orgId).maybeSingle()
 if(error)return NextResponse.json({error:'The saved draft could not be loaded. Reload to retry.'},{status:503})
 if(!data)return NextResponse.json({error:'This saved draft is unavailable in the selected property.'},{status:404})
 return NextResponse.json({brief:data},{headers:{'Cache-Control':'private, no-store'}})
}catch(e){return marketError(e)}}
