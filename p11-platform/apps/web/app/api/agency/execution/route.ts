import {NextResponse} from 'next/server'
import {executionCommand,executionQuery} from '@/utils/agency/execution'
import {AgencyError,agencyActor,readExecution,operateExecution} from '@/utils/agency/execution-store'
const headers={'Cache-Control':'private, no-store'}
function failure(e:unknown){return NextResponse.json({error:e instanceof AgencyError?e.message:'The agency is unavailable.'},{status:e instanceof AgencyError?e.status:503,headers})}
async function body(req:Request){
 const limit=32768;if(Number(req.headers.get('content-length'))>limit)throw new AgencyError('The execution request exceeds the supported size.',413)
 const reader=req.body?.getReader();if(!reader)throw new AgencyError('Provide an agency decision.',400)
 const chunks:Uint8Array[]=[];let total=0
 try{while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new AgencyError('The execution request exceeds the supported size.',413)}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new AgencyError('Provide a valid agency decision.',400)}
}
export async function GET(req:Request){try{const actor=await agencyActor(),query=executionQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!query.success)throw new AgencyError('Choose a saved property or review history.',400);const{propertyId,...input}=query.data;return NextResponse.json(await readExecution(actor,propertyId,input),{headers})}catch(e){return failure(e)}}
export async function POST(req:Request){try{const actor=await agencyActor(),command=executionCommand.safeParse(await body(req));if(!command.success)throw new AgencyError(command.error.issues[0]?.message||'Review the evidence and reason.',400);return NextResponse.json(await operateExecution(actor,command.data),{headers})}catch(e){return failure(e)}}
