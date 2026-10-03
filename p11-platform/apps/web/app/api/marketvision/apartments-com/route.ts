import {NextRequest,NextResponse} from 'next/server'
import {requireMarketOperator,marketError} from '@/utils/marketvision/decision-store'
async function retired(req:NextRequest){try{
 const raw=req.method==='GET'?Object.fromEntries(req.nextUrl.searchParams):await req.json().catch(()=>({}))
 await requireMarketOperator(String(raw.propertyId??''))
 return NextResponse.json({error:'Open the competitor source panel to save a source request and review its exact pricing candidates. Earlier automatic discovery and refresh routes are retired.',code:'saved_source_review_required'},{status:410,headers:{'Cache-Control':'private, no-store'}})
}catch(e){return marketError(e)}}
export const POST=retired
export const GET=retired
