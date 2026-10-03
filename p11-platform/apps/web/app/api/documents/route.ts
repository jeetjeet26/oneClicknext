import {GET as inventoryGET} from '../community/knowledge-inventory/route'
import {NextRequest,NextResponse} from 'next/server'
import {inventoryActor,InventoryError} from '@/utils/knowledge/inventory'

export async function GET(req: NextRequest) {
 const url=new URL(req.url);url.searchParams.set('kind','documents')
 const response=await inventoryGET(new Request(url,{headers:req.headers}))
 if(!response.ok)return response
 const data=await response.json()
 return NextResponse.json({...data,documents:data.items.map((item:{key:string;title:string;source:string|null;chunkCount:number;lastCreatedAt:string|null;identityBasis:string})=>({id:item.key,title:item.title,source:item.source,chunks:item.chunkCount,created_at:item.lastCreatedAt,identityBasis:item.identityBasis,preview:''}))},{headers:{'Cache-Control':'private, no-store'}})
}

export async function DELETE(){try{await inventoryActor();return NextResponse.json({error:'Shared source labels cannot identify a safe deletion. Open the exact saved source and use its recorded withdrawal.'},{status:410})}catch(e){return NextResponse.json({error:e instanceof InventoryError?e.message:'Knowledge history is unavailable.'},{status:e instanceof InventoryError?e.status:503})}}
