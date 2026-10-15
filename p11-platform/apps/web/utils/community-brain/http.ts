import {BrainError} from './contracts'
import {ZodError} from 'zod'
export const privateHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
export function requireConsoleOrigin(request:Request) {
  // Next may normalize its internal request hostname behind the local or
  // deployment proxy. The browser's Host remains the request authority.
  const url=new URL(request.url),host=request.headers.get('host')||url.host
  if(request.headers.get('origin')!==`${url.protocol}//${host}`)throw new BrainError('Open this request from the console.',403)
}
export async function boundedJson(request:Request,limit=16384):Promise<unknown> {
  const reader=request.body?.getReader();if(!reader)throw new BrainError('Provide a request.',400)
  const chunks:Uint8Array[]=[];let total=0
  try {for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();throw new BrainError('The request is too large.',413)}chunks.push(value)}}finally{reader.releaseLock()}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))}catch{throw new BrainError('Provide a valid request.',400)}
}
export function brainFailure(error:unknown) {
  if(error instanceof ZodError)return Response.json({error:'Check the selected community and request fields.'},{status:400,headers:privateHeaders})
  return Response.json({error:error instanceof BrainError?error.message:'The community operation is unavailable.'},{status:error instanceof BrainError?error.status:503,headers:privateHeaders})
}
