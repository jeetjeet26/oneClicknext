import {NextResponse}from 'next/server'
import {InventoryError}from '@/utils/knowledge/inventory'
export const teamHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}
export function teamFailure(e:unknown){return NextResponse.json({error:e instanceof InventoryError?e.message:'Team access is unavailable.'},{status:e instanceof InventoryError?e.status:503,headers:teamHeaders})}
export async function teamBody(req:Request,limit=16384){
 if(Number(req.headers.get('content-length'))>limit)throw new InventoryError('This team request exceeds the supported size.',413)
 const reader=req.body?.getReader();if(!reader)throw new InventoryError('Provide the team decision.',400)
 const chunks:Uint8Array[]=[];let total=0
 try{while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new InventoryError('This team request exceeds the supported size.',413)}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let n=0;for(const c of chunks){bytes.set(c,n);n+=c.length}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new InventoryError('Provide a valid team decision.',400)}
}

export function requireTeamOrigin(req:Request){if(req.headers.get('origin')!==`${new URL(req.url).protocol}//${req.headers.get('host')||new URL(req.url).host}`)throw new InventoryError('Open this team decision from the console to continue.',403)}
