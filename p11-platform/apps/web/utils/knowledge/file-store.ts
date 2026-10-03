import {createHash} from 'node:crypto'
import {createServiceClient} from '@/utils/supabase/admin'
import {InventoryError,inventoryActor} from './inventory'
import {fileUploadFields,type FileCommand,type FileDetail,type FileReceipt,type OriginalFile} from './file-contracts'
import {extractOriginal} from './file-extraction'
export {InventoryError as FileError,inventoryActor as fileActor}
const bucket='knowledge-originals'
type Value=Record<string,unknown>
const messages:Record<string,string>={forbidden:'This file is unavailable in your current property.',not_found:'The retained file or decision is unavailable.',request_conflict:'This request differs from its saved decision.',decision_cancelled:'This unused request was cancelled. Begin a new reviewed request.',file_changed:'The file changed. Reload and review its current state.',source_changed:'The destination source changed. Reload its latest version before replacing it.',extraction_changed:'The selected extraction changed. Reload its retained result.',existing_extraction:'An extraction is already saved. Open its result or stop it before starting another.',closed_request:'This request is already closed. Reload its saved status.',storage_required:'The original file must be retained and verified first.',history_changed:'File history changed. Reload before continuing.',bytes_changed:'The stored bytes do not match the retained original. Nothing was extracted or published.'}
export async function fileRpc(name:string,args:Value){
 const db=createServiceClient()as unknown as{rpc:(name:string,args:Value)=>Promise<{data:Value|null;error:unknown}>}
 const{data,error}=await db.rpc(name,args)
 if(error||!data)throw new InventoryError('This file operation could not be confirmed. Check its retained decision before retrying.')
 if(!['ready','saved','replayed','cancelled','queued','running','held','stopped','invoke_once'].includes(String(data.state)))throw new InventoryError(messages[String(data.state)]||'Review the retained file before continuing.',data.state==='forbidden'?403:data.state==='not_found'?404:409)
 return data
}
export function readFiles(actor:string,propertyId:string,input:Value){return fileRpc('read_knowledge_files',{p_property_id:propertyId,p_actor_id:actor,p_input:input})}
async function detail(actor:string,propertyId:string,id:string){return await readFiles(actor,propertyId,{kind:'file',fileId:id})as unknown as FileDetail}
export async function verifyOriginal(file:OriginalFile){
 const{data,error}=await createServiceClient().storage.from(bucket).download(file.storage_path)
 if(error||!data)throw new InventoryError('The original file has not been confirmed in private storage. Re-select the same file or check the saved upload.',503)
 if(data.size!==file.input.size)throw new InventoryError(messages.bytes_changed,409)
 const bytes=new Uint8Array(await data.arrayBuffer())
 if(createHash('sha256').update(bytes).digest('hex')!==file.input.byteHash)throw new InventoryError(messages.bytes_changed,409)
 return bytes
}
export async function uploadOriginal(actor:string,form:FormData){
 const file=form.get('file'),fields=Object.fromEntries([...form.entries()].filter(([key])=>key!=='file'))
 if(!(file instanceof File)||[...form.keys()].length!==6)throw new InventoryError('Choose one file and a reviewed upload request.',400)
 const parsed=fileUploadFields.safeParse({...fields,materialId:fields.materialId||null})
 if(!parsed.success)throw new InventoryError('Provide the saved property, title and reason for this original.',400)
 const{requestId,propertyId,title,reason,materialId}=parsed.data
 const extension=file.name.split('.').pop()?.toLowerCase(),mimeType=extension==='pdf'?'application/pdf':extension==='txt'?'text/plain':extension==='md'?'text/markdown':null
 if(!mimeType||!file.size||file.size>(mimeType==='application/pdf'?10485760:262144)||file.name.length>255||/[\u0000-\u001f\u007f]/.test(file.name))throw new InventoryError('Choose a PDF up to 10 MiB or UTF-8 .txt/.md up to 256 KiB.',400)
 const bytes=new Uint8Array(await file.arrayBuffer())
 if(mimeType==='application/pdf'&&new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new InventoryError('The selected file does not have a PDF signature.',400)
 const byteHash=createHash('sha256').update(bytes).digest('hex')
 const result=await fileRpc('begin_knowledge_file',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:{title,fileName:file.name,mimeType,size:bytes.length,byteHash,reason,materialId}})
 const current=await detail(actor,propertyId,requestId)
 if(current.file.state==='stopped')return{...result,fileState:'stopped'}
 if(current.file.state==='pending'){
  // Never overwrite an existing object, including after a lost upload response.
  await createServiceClient().storage.from(bucket).upload(current.file.storage_path,bytes,{contentType:mimeType,upsert:false})
 }
 await verifyOriginal(current.file)
 const stored=await fileRpc('finish_knowledge_file_storage',{p_id:requestId,p_actor_id:actor,p_byte_hash:byteHash,p_size:bytes.length})
 return{...result,fileState:stored.fileState||stored.state}
}
export async function runFileExtraction(id:string){
 const claim=await fileRpc('claim_knowledge_file_extraction',{p_id:id})
 if(claim.state!=='invoke_once')return claim
 const file=claim.file as OriginalFile
 let receipt:FileReceipt
 try{receipt=await extractOriginal(await verifyOriginal(file),file.input.mimeType,file.input.byteHash)}catch{receipt={recipe:'unpdf-1.4.0-pages-v1',fileHash:file.input.byteHash,complete:false,totalPages:null,pages:[],text:'',errorCode:'original_unavailable',blankPages:[],limitations:[]}}
 if(Buffer.byteLength(JSON.stringify(receipt))>7*1024*1024)receipt={...receipt,complete:false,pages:[],text:'',errorCode:'receipt_limit',blankPages:[],limitations:['The extracted receipt exceeded the retention limit. The complete binary original remains retained.']}
 const args={p_id:id,p_claim_token:claim.claimToken,p_receipt:receipt}
 try{return await fileRpc('record_knowledge_file_extraction',args)}catch{return fileRpc('record_knowledge_file_extraction',args)}
}
export async function decideFile(actor:string,command:FileCommand){
 const{requestId,propertyId,operation,...input}=command
 const result=await fileRpc(operation==='cancel_unused'?'cancel_unused_knowledge_decision':'decide_knowledge_file',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:operation==='cancel_unused'?input:{...input,operation}})
 if(operation==='extract'||operation==='recover_extraction')return{...result,execution:await runFileExtraction(String(result.extractionId))}
 if(operation==='recover_upload'){
  const current=await detail(actor,propertyId,String(result.fileId));await verifyOriginal(current.file)
  return{...result,execution:await fileRpc('finish_knowledge_file_storage',{p_id:current.file.id,p_actor_id:actor,p_byte_hash:current.file.input.byteHash,p_size:current.file.input.size})}
 }
 return result
}
export async function downloadOriginal(actor:string,propertyId:string,fileId:string,decisionId:string){
 const receipt=await readFiles(actor,propertyId,{kind:'decision',decisionId})
 if(receipt.fileId!==fileId||receipt.prepared!==true)throw new InventoryError('Prepare this exact original download first.',409)
 const current=await detail(actor,propertyId,fileId)
 if(current.file.state!=='stored'||receipt.byteHash!==current.file.input.byteHash)throw new InventoryError('The original download is no longer available.',409)
 const bytes=await verifyOriginal(current.file)
 // Recheck current access after storage retrieval; do not hand out a reusable public URL.
 await detail(actor,propertyId,fileId)
 return{bytes,fileName:current.file.input.fileName}
}
