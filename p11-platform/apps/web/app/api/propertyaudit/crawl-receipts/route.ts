import {NextResponse} from 'next/server'
import {crawlReceiptRead} from '@/utils/propertyaudit/crawl-contracts'
import {auditActor,auditRpc,InventoryError} from '@/utils/propertyaudit/decision-store'
import {teamHeaders as headers} from '@/utils/team/http'
export const runtime='nodejs'
export async function GET(req:Request){try{
 const parsed=crawlReceiptRead.safeParse(Object.fromEntries(new URL(req.url).searchParams))
 if(!parsed.success)throw new InventoryError('Choose valid captured crawl evidence.',400)
 const{propertyId,crawlId,id,offset,hash}=parsed.data,actorId=await auditActor(propertyId)
 const data=await auditRpc('read_geo_crawl_receipts',{p_actor_id:actorId,p_property_id:propertyId,p_crawl_id:crawlId,p_id:id??null,p_offset:offset,p_hash:hash??null})
 return NextResponse.json({...data,actorId,crawlId},{headers})
 }catch(e){return NextResponse.json({error:e instanceof InventoryError?e.message:'Captured crawl evidence is unavailable. Refresh to try again.'},{status:e instanceof InventoryError?e.status:503,headers})}}
