import {NextResponse} from 'next/server'
import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
import {webActor,downloadWeb,WebError} from '@/utils/knowledge/web-store'
const schema=z.object({propertyId:id,captureId:id,decisionId:id}).strict(),headers={'Cache-Control':'private, no-store'}
export async function GET(req:Request){try{const actor=await webActor(),query=schema.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!query.success)throw new WebError('Choose an exact prepared website download.',400);const{propertyId,captureId,decisionId}=query.data,bytes=await downloadWeb(actor,propertyId,captureId,decisionId);return new Response(bytes,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="website-original.txt"','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}})}catch(e){return NextResponse.json({error:e instanceof WebError?e.message:'The retained website original is unavailable.'},{status:e instanceof WebError?e.status:503,headers})}}
