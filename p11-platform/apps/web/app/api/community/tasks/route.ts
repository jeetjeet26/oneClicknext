import {NextResponse} from 'next/server'
import {checklistCommand,checklistQuery} from '@/utils/checklist/contracts'
import {ChecklistError,checklistActor,readChecklist,decideChecklist} from '@/utils/checklist/store'
const headers={'Cache-Control':'private, no-store'}
function failure(e:unknown){return NextResponse.json({error:e instanceof ChecklistError?e.message:'The checklist is unavailable.'},{status:e instanceof ChecklistError?e.status:503,headers})}
async function body(req:Request){
 const limit=32768;if(Number(req.headers.get('content-length'))>limit)throw new ChecklistError('The task request exceeds the supported size.',413)
 const reader=req.body?.getReader();if(!reader)throw new ChecklistError('Provide a checklist decision.',400)
 const chunks:Uint8Array[]=[];let total=0
 try{while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new ChecklistError('The task request exceeds the supported size.',413)}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new ChecklistError('Provide a valid checklist decision.',400)}
}
export async function GET(req:Request){try{const actor=await checklistActor(),query=checklistQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!query.success)throw new ChecklistError('Choose a saved property, task or history page.',400);const{propertyId,...input}=query.data;return NextResponse.json(await readChecklist(actor,propertyId,input),{headers})}catch(e){return failure(e)}}
export async function POST(req:Request){try{const actor=await checklistActor(),command=checklistCommand.safeParse(await body(req));if(!command.success)throw new ChecklistError(command.error.issues[0]?.message||'Review the task and reason.',400);return NextResponse.json(await decideChecklist(actor,command.data),{headers})}catch(e){return failure(e)}}
export async function PUT(){return NextResponse.json({error:'Use the reviewed checklist decision with its saved task version.'},{status:410,headers})}
