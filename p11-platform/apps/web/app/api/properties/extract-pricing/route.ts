import {NextResponse} from 'next/server'
import {inventoryActor,InventoryError} from '@/utils/knowledge/inventory'
export async function POST(){try{await inventoryActor();return NextResponse.json({error:'Use the reviewed floor-plan editor to save exact facts, inspect their source and approve them. Assistant facts are prepared and published separately.'},{status:410,headers:{'Cache-Control':'private, no-store'}})}catch(e){return NextResponse.json({error:e instanceof InventoryError?e.message:'Floor-plan review is unavailable.'},{status:e instanceof InventoryError?e.status:503})}}
