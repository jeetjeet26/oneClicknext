import {NextRequest,NextResponse} from 'next/server'
import {historyRead} from '@/utils/marketvision/decision-contracts'
import {requireMarketOperator,marketRpc,MarketStoreError,marketError} from '@/utils/marketvision/decision-store'
export async function GET(req:NextRequest){try{const parsed=historyRead.safeParse(Object.fromEntries(req.nextUrl.searchParams));if(!parsed.success)throw new MarketStoreError('Choose a property and saved history.',400);const {propertyId,resourceId,cursor}=parsed.data,actor=await requireMarketOperator(propertyId);return NextResponse.json(await marketRpc('read_marketvision_history',{p_property_id:propertyId,p_actor_id:actor,p_resource_id:resourceId??null,p_cursor:cursor??null}))}catch(e){return marketError(e)}}
