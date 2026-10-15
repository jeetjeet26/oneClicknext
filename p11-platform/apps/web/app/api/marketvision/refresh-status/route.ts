import {NextRequest,NextResponse} from 'next/server'
import {marketId} from '@/utils/marketvision/decision-contracts'
import {requireMarketOperator,marketError,MarketStoreError} from '@/utils/marketvision/decision-store'
import {readRefreshStatus} from '@/utils/marketvision/refresh-status'
export async function GET(req:NextRequest){try{
 const values=req.nextUrl.searchParams.getAll('propertyId'),id=marketId.safeParse(values[0])
 if(!id.success||values.length!==1||[...req.nextUrl.searchParams.keys()].some(k=>k!=='propertyId'))throw new MarketStoreError('Choose one property.',400)
 const actor=await requireMarketOperator(id.data),data=await readRefreshStatus(id.data)
 if(await requireMarketOperator(id.data)!==actor)throw new MarketStoreError('Your session changed. Reload this property.',403)
 return NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}})
}catch(e){return marketError(e)}}
