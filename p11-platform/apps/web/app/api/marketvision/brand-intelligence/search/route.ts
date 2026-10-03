import {NextResponse} from 'next/server'
const retired=()=>NextResponse.json({error:'This earlier brand workflow is retired. Review retained pages and saved brand evidence in MarketVision.'},{status:410,headers:{'Cache-Control':'private, no-store'}})
export const POST=retired
