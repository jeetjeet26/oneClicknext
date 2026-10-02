import {GET as inventoryGET} from '../knowledge-inventory/route'
import {NextRequest,NextResponse}from 'next/server'
import {inventoryActor,InventoryError}from '@/utils/knowledge/inventory'
// Compatibility overview: counts cover the full property, source rows are explicitly paged.
export async function GET(request: NextRequest) {
 const response=await inventoryGET(request)
 if(!response.ok)return response
 const data=await response.json()
 return NextResponse.json({...data,sources:data.items,sourceCount:data.summary.sourceCount,hasWebsiteSources:data.summary.hasWebsiteSources,documentsCount:data.summary.chunkCount,uniqueDocuments:data.summary.documentGroups,categories:{},insights:[]},{headers:{'Cache-Control':'private, no-store'}})
}

export async function POST(){try{await inventoryActor();return NextResponse.json({error:'Save the property, then use Website Sources in Community knowledge to retain and review each page. Search preparation and publication are separate.'},{status:410,headers:{'Cache-Control':'private, no-store'}})}catch(e){return NextResponse.json({error:e instanceof InventoryError?e.message:'Website review is unavailable.'},{status:e instanceof InventoryError?e.status:503,headers:{'Cache-Control':'private, no-store'}})}}
