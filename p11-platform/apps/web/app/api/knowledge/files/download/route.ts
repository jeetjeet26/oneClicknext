import {NextResponse} from 'next/server'
import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
import {FileError,fileActor,downloadOriginal} from '@/utils/knowledge/file-store'
const query=z.object({propertyId:id,fileId:id,decisionId:id}).strict()
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}
export async function GET(req:Request){try{const actor=await fileActor(),input=query.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!input.success)throw new FileError('Choose an exact prepared original download.',400);const file=await downloadOriginal(actor,input.data.propertyId,input.data.fileId,input.data.decisionId);return new Response(file.bytes,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="original"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'Content-Length':String(file.bytes.length)}})}catch(e){return NextResponse.json({error:e instanceof FileError?e.message:'The private original is unavailable.'},{status:e instanceof FileError?e.status:503,headers})}}
