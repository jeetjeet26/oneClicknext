import {NextResponse} from 'next/server'
import {legalCommand,legalQuery} from '@/utils/legal-review/contracts'
import {LegalReviewError,legalReviewActor,readLegal,decideLegal} from '@/utils/legal-review/store'
const headers={'Cache-Control':'private, no-store'}
function failure(e:unknown){return NextResponse.json({error:e instanceof LegalReviewError?e.message:'Legal review is unavailable.'},{status:e instanceof LegalReviewError?e.status:503,headers})}
async function body(req:Request){
 const limit=1048576;if(Number(req.headers.get('content-length'))>limit)throw new LegalReviewError('The legal request exceeds the supported size.',413)
 const reader=req.body?.getReader();if(!reader)throw new LegalReviewError('Provide a legal decision.',400)
 const chunks:Uint8Array[]=[];let total=0
 try{while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new LegalReviewError('The legal request exceeds the supported size.',413)}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new LegalReviewError('Provide a valid legal decision.',400)}
}
export async function GET(req:Request){try{const actor=await legalReviewActor(),query=legalQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!query.success)throw new LegalReviewError('Choose a saved property, legal version or history page.',400);const{propertyId,...input}=query.data;return NextResponse.json(await readLegal(actor,propertyId,input),{headers})}catch(e){return failure(e)}}
export async function POST(req:Request){try{const actor=await legalReviewActor(),command=legalCommand.safeParse(await body(req));if(!command.success)throw new LegalReviewError(command.error.issues[0]?.message||'Review the legal version and reason.',400);return NextResponse.json(await decideLegal(actor,command.data),{headers})}catch(e){return failure(e)}}
export async function PUT(){return NextResponse.json({error:'Use the reviewed legal decision with its exact saved legal version.'},{status:410,headers})}
