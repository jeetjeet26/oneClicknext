import {NextResponse} from 'next/server'
import {readinessCommand,readinessQuery} from '@/utils/readiness/contracts'
import {ReadinessError,readinessActor,readReadiness,decideReadiness} from '@/utils/readiness/store'
const headers={'Cache-Control':'private, no-store'}
function failure(e:unknown){return NextResponse.json({error:e instanceof ReadinessError?e.message:'Readiness review is unavailable.'},{status:e instanceof ReadinessError?e.status:503,headers})}
async function body(req:Request){
 const limit=32768;if(Number(req.headers.get('content-length'))>limit)throw new ReadinessError('The readiness request exceeds the supported size.',413)
 const reader=req.body?.getReader();if(!reader)throw new ReadinessError('Provide a readiness decision.',400)
 const chunks:Uint8Array[]=[];let total=0
 try{while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new ReadinessError('The readiness request exceeds the supported size.',413)}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new ReadinessError('Provide a valid readiness decision.',400)}
}
export async function GET(req:Request){try{const actor=await readinessActor(),query=readinessQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!query.success)throw new ReadinessError('Choose a saved property, readiness version or history page.',400);const{propertyId,...input}=query.data;return NextResponse.json(await readReadiness(actor,propertyId,input),{headers})}catch(e){return failure(e)}}
export async function POST(req:Request){try{const actor=await readinessActor(),command=readinessCommand.safeParse(await body(req));if(!command.success)throw new ReadinessError(command.error.issues[0]?.message||'Review the readiness version and reason.',400);return NextResponse.json(await decideReadiness(actor,command.data),{headers})}catch(e){return failure(e)}}
export async function PUT(){return NextResponse.json({error:'Use the reviewed readiness decision with its exact saved readiness version.'},{status:410,headers})}
