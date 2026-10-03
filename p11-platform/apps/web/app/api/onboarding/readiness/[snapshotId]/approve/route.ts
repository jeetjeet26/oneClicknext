import {NextResponse} from 'next/server'
export async function POST(){return NextResponse.json({error:'Use the exact saved readiness review, current source evidence and recorded decision.'},{status:410,headers:{'Cache-Control':'private, no-store'}})}
