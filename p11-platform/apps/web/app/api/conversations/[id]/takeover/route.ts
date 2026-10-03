import {NextResponse} from 'next/server'
function retired(){return NextResponse.json({error:'Open the LumaLeasing conversation inbox to review the current transcript and record takeover or release.'},{status:410,headers:{'Cache-Control':'private, no-store'}})}
export const POST=retired
export const DELETE=retired
