import {NextResponse} from 'next/server'
import {fileCommand,fileQuery} from '@/utils/knowledge/file-contracts'
import {FileError,fileActor,readFiles,decideFile,uploadOriginal} from '@/utils/knowledge/file-store'
const headers={'Cache-Control':'private, no-store'}
export const runtime='nodejs'
function failure(e:unknown){return NextResponse.json({error:e instanceof FileError?e.message:'Retained files are unavailable.'},{status:e instanceof FileError?e.status:503,headers})}
async function boundedBytes(req:Request,limit:number){
 if(Number(req.headers.get('content-length'))>limit)throw new FileError('The request exceeds the supported size.',413)
 const reader=req.body?.getReader();if(!reader)throw new FileError('Provide a file decision.',400)
 const chunks:Uint8Array[]=[];let total=0
 try{while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new FileError('The request exceeds the supported size.',413)}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes
}
export async function GET(req:Request){try{const actor=await fileActor(),query=fileQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));if(!query.success)return NextResponse.json({error:'Choose a saved file and a valid history page.'},{status:400,headers});const{propertyId,...input}=query.data;return NextResponse.json(await readFiles(actor,propertyId,input),{headers})}catch(e){return failure(e)}}
export async function POST(req:Request){try{
 const actor=await fileActor()
 if(req.headers.get('content-type')?.startsWith('multipart/form-data')){
  const bytes=await boundedBytes(req,10485760+16384);let form:FormData
  try{form=await new Response(bytes,{headers:{'content-type':req.headers.get('content-type')!}}).formData()}catch{throw new FileError('Provide a complete file upload.',400)}
  return NextResponse.json(await uploadOriginal(actor,form),{headers})
 }
 const bytes=await boundedBytes(req,1048576);let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new FileError('Provide a valid file decision.',400)}
 const command=fileCommand.safeParse(body);if(!command.success)throw new FileError('Review the file, exact extraction and reason before continuing.',400)
 return NextResponse.json(await decideFile(actor,command.data),{headers})
}catch(e){return failure(e)}}
