import {NextResponse} from 'next/server'
import {inventoryActor,InventoryError} from '@/utils/knowledge/inventory'
export async function POST(){try{await inventoryActor();return NextResponse.json({error:'Use the saved knowledge source workflow to review exact text before publication.'},{status:410})}catch(e){return NextResponse.json({error:e instanceof InventoryError?e.message:'Knowledge intake is unavailable.'},{status:e instanceof InventoryError?e.status:503})}}
