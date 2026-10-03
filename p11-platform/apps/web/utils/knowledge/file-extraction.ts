import {Worker} from 'node:worker_threads'
import {resolve} from 'node:path'
import type {FileReceipt} from './file-contracts'
const recipe='unpdf-1.4.0-pages-v1'
export async function extractOriginal(bytes:Uint8Array,mimeType:string,fileHash:string):Promise<FileReceipt>{
 const base={recipe,fileHash,complete:false,totalPages:null,pages:[],text:'',errorCode:null,blankPages:[],limitations:[]} satisfies FileReceipt
 if(mimeType!=='application/pdf'){
  try{
   const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)
   if(!text.trim()||text.includes('\0'))return{...base,errorCode:'invalid_text'}
   return{...base,complete:true,totalPages:1,pages:[text],text}
  }catch{return{...base,errorCode:'invalid_utf8'}}
 }
 return new Promise(resolveResult=>{
  let settled=false
  const owned=new Uint8Array(bytes)
  const worker=new Worker(resolve(process.cwd(),'runtime-assets/knowledge-pdf-worker.cjs'),{workerData:{buffer:owned.buffer,expectedHash:fileHash},transferList:[owned.buffer],execArgv:[],env:{},resourceLimits:{maxOldGenerationSizeMb:160,maxYoungGenerationSizeMb:32}})
  const finish=(value:Partial<FileReceipt>)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();resolveResult({...base,...value,recipe,fileHash})}
  const timer=setTimeout(()=>finish({errorCode:'extraction_timeout'}),20000)
  worker.once('message',value=>finish(value))
  worker.once('error',()=>finish({errorCode:'extraction_failed'}))
  worker.once('exit',()=>finish({errorCode:'extraction_interrupted'}))
 })
}
