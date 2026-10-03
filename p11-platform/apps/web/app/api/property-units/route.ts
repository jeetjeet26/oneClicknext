import {NextResponse} from 'next/server'
import {unitCommand,unitQuery} from '@/utils/property-units/contracts'
import {UnitError,unitActor,readUnits,decideUnit} from '@/utils/property-units/store'
const headers={'Cache-Control':'private, no-store'}
function failure(e:unknown){return NextResponse.json({error:e instanceof UnitError?e.message:'Floor-plan review is unavailable.'},{status:e instanceof UnitError?e.status:503,headers})}
async function boundedBytes(req:Request,limit:number){
 if(Number(req.headers.get('content-length'))>limit)throw new UnitError('The request exceeds the supported size.',413)
 const reader=req.body?.getReader();if(!reader)throw new UnitError('Provide a floor-plan decision.',400)
 const chunks:Uint8Array[]=[];let total=0
 try{while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new UnitError('The request exceeds the supported size.',413)}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes
}
export async function GET(req:Request){try{const actor=await unitActor(),query=unitQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!query.success)return NextResponse.json({error:'Choose a saved property, floor plan and history page.'},{status:400,headers});const{propertyId,...input}=query.data;return NextResponse.json(await readUnits(actor,propertyId,input),{headers})}catch(e){return failure(e)}}
export async function POST(req:Request){try{const actor=await unitActor();const bytes=await boundedBytes(req,262144);let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new UnitError('Provide a valid floor-plan decision.',400)}const command=unitCommand.safeParse(body);if(!command.success)throw new UnitError(command.error.issues[0]?.message||'Review the complete facts, source evidence and reason.',400);return NextResponse.json(await decideUnit(actor,command.data),{headers})}catch(e){return failure(e)}}
