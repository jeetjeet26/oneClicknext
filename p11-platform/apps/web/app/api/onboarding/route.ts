import {NextResponse} from 'next/server'
import {organizationCommand,organizationQuery} from '@/utils/property-setup/organization-contracts'
import {OrganizationError as WebError,organizationActor as webActor,readOrganizationSetup,decideOrganizationSetup} from '@/utils/property-setup/organization-store'
const headers={'Cache-Control':'private, no-store'}
function failure(e:unknown){return NextResponse.json({error:e instanceof WebError?e.message:'Organization setup is unavailable.'},{status:e instanceof WebError?e.status:503,headers})}
async function boundedBytes(req:Request,limit:number){
 if(Number(req.headers.get('content-length'))>limit)throw new WebError('The request exceeds the supported size.',413)
 const reader=req.body?.getReader();if(!reader)throw new WebError('Provide a organization setup decision.',400)
 const chunks:Uint8Array[]=[];let total=0
 try{while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new WebError('The request exceeds the supported size.',413)}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes
}
export async function GET(req:Request){try{const actor=await webActor(),query=organizationQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!query.success)return NextResponse.json({error:'Choose a saved setup decision or history page.'},{status:400,headers});const value=await readOrganizationSetup(actor,query.data);return NextResponse.json({...value,needsOnboarding:!value.alreadyMember&&(value.setup as {state?:string}|null)?.state!=='completed'},{headers})}catch(e){return failure(e)}}
export async function POST(req:Request){try{const actor=await webActor();const bytes=await boundedBytes(req,524288);let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new WebError('Provide a valid organization setup decision.',400)}const command=organizationCommand.safeParse(body);if(!command.success)throw new WebError(command.error.issues[0]?.message||'Review the organization setup and reason.',400);return NextResponse.json(await decideOrganizationSetup(actor,command.data),{headers})}catch(e){return failure(e)}}
