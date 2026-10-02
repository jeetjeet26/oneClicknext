import {NextResponse} from 'next/server'
import {neighborhoodCommand,neighborhoodQuery} from '@/utils/neighborhood/contracts'
import {NeighborhoodReviewError,neighborhoodReviewActor,readNeighborhood,decideNeighborhood} from '@/utils/neighborhood/store'
const headers={'Cache-Control':'private, no-store'}
function failure(e:unknown){return NextResponse.json({error:e instanceof NeighborhoodReviewError?e.message:'Neighborhood review is unavailable.'},{status:e instanceof NeighborhoodReviewError?e.status:503,headers})}
async function body(req:Request){
 const limit=32768;if(Number(req.headers.get('content-length'))>limit)throw new NeighborhoodReviewError('The neighborhood request exceeds the supported size.',413)
 const reader=req.body?.getReader();if(!reader)throw new NeighborhoodReviewError('Provide a neighborhood decision.',400)
 const chunks:Uint8Array[]=[];let total=0
 try{while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new NeighborhoodReviewError('The neighborhood request exceeds the supported size.',413)}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new NeighborhoodReviewError('Provide a valid neighborhood decision.',400)}
}
export async function GET(req:Request){try{const actor=await neighborhoodReviewActor(),query=neighborhoodQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!query.success)throw new NeighborhoodReviewError('Choose a saved property, neighborhood version or history page.',400);const{propertyId,...input}=query.data;return NextResponse.json(await readNeighborhood(actor,propertyId,input),{headers})}catch(e){return failure(e)}}
export async function POST(req:Request){try{const actor=await neighborhoodReviewActor(),command=neighborhoodCommand.safeParse(await body(req));if(!command.success)throw new NeighborhoodReviewError(command.error.issues[0]?.message||'Review the neighborhood version and reason.',400);return NextResponse.json(await decideNeighborhood(actor,command.data),{headers})}catch(e){return failure(e)}}
export async function PUT(){return NextResponse.json({error:'Use the reviewed neighborhood decision with its exact saved neighborhood version.'},{status:410,headers})}
