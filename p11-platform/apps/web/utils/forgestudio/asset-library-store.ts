import {createHash} from 'node:crypto'
import sharp, {type Metadata} from 'sharp'
import {z} from 'zod'
import {createServiceClient} from '@/utils/supabase/admin'
import {ContentStoreError} from './content-store'
import {rightsStatus} from './asset-library'
import {STORAGE_BUCKETS} from '@/utils/storage/asset-service'
type ObjectValue=Record<string,unknown>
const messages:Record<string,string>={forbidden:'Your current access does not allow this asset decision.',stale_asset:'This asset changed. Reload its saved version before editing it.',request_conflict:'This request differs from its saved version. Reload the saved work.',asset_archived:'This asset is archived. Restore it before reviewing it.',asset_not_archived:'This asset is already in the active library. Reload its saved state.',asset_unavailable:'This asset is unavailable for this property.',asset_duplicate:'A duplicate cannot be approved as a separate asset.',replacement_changed:'The original asset changed after this upload started. Recover the stored file separately or reload the original before replacing it.',duplicate_archived:'This exact file already exists in the archive. Restore its saved library record.',upload_unavailable:'The saved upload is unavailable.'}
export async function assetLibraryRpc(name:string,args:ObjectValue,allowed=['saved','replayed','prepared']){
 const client=createServiceClient() as unknown as {rpc:(name:string,args:ObjectValue)=>Promise<{data:ObjectValue|null;error:unknown}>}
 const {data,error}=await client.rpc(name,args)
 if(error||!data)throw new ContentStoreError('The saved asset result could not be confirmed. Reload the library or recover the saved upload.',503)
 if(!allowed.includes(String(data.state)))throw new ContentStoreError(messages[String(data.state)]||'This saved asset decision needs review.',data.state==='forbidden'?403:409)
 return data
}
const MAX_FILE_BYTES=100*1024*1024
export async function boundedAssetForm(request:Request){
 const limit=MAX_FILE_BYTES+64*1024,reader=request.body?.getReader();if(!reader)throw new ContentStoreError('Choose an asset file.',400)
 const chunks:Uint8Array[]=[];let size=0
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new ContentStoreError('The upload is too large. Use an image up to 20 MB or a video up to 100 MB.',413)}chunks.push(value)}}finally{reader.releaseLock()}
 return new Response(Buffer.concat(chunks),{headers:{'Content-Type':request.headers.get('Content-Type')||''}}).formData()
}
export async function inspectAssetFile(file:File){
 const types:Record<string,{extension:string;asset_type:string}>={'image/png':{extension:'png',asset_type:'image'},'image/jpeg':{extension:'jpg',asset_type:'image'},'image/webp':{extension:'webp',asset_type:'image'},'image/gif':{extension:'gif',asset_type:'gif'},'video/mp4':{extension:'mp4',asset_type:'video'},'video/webm':{extension:'webm',asset_type:'video'}}
 const kind=types[file.type];if(!kind||file.size===0)throw new ContentStoreError('Choose a PNG, JPEG, WebP, GIF, MP4 or WebM file.',400)
 if(file.size>(kind.asset_type==='video'?MAX_FILE_BYTES:20*1024*1024))throw new ContentStoreError('Images must be 20 MB or smaller; videos must be 100 MB or smaller.',413)
 const bytes=Buffer.from(await file.arrayBuffer());let width:number|null=null,height:number|null=null
 if(kind.asset_type==='video'){
  const valid=kind.extension==='mp4'?bytes.subarray(4,8).toString()==='ftyp':bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))
  if(!valid)throw new ContentStoreError('The file contents do not match its video type.',400)
 }else{
  let metadata:Metadata
  try{metadata=await sharp(bytes,{limitInputPixels:100_000_000}).metadata()}catch{throw new ContentStoreError('The image could not be read.',400)}
  if(metadata.format!==(kind.extension==='jpg'?'jpeg':kind.extension))throw new ContentStoreError('The file contents do not match its image type.',400)
  width=metadata.width??null;height=metadata.height??null
 }
 return {...kind,bytes,width,height,contentHash:createHash('sha256').update(bytes).digest('hex')}
}
export async function uploadLibraryAsset(form:FormData,actorId:string,propertyId:string){
 const requestId=z.string().uuid().parse(form.get('requestId')),file=form.get('file')
 if(!(file instanceof File))throw new ContentStoreError('Choose an asset file.',400)
 const inspected=await inspectAssetFile(file)
 const metadata={name:z.string().trim().min(1).max(255).parse(String(form.get('name')||file.name)),description:z.string().max(2000).parse(String(form.get('description')||'')),asset_type:inspected.asset_type,alt_text:z.string().max(1000).parse(String(form.get('altText')||'')),folder:z.string().trim().max(120).parse(String(form.get('folder')||'')),tags:[],rights_status:rightsStatus.parse(form.get('rightsStatus')||'unknown'),rights_metadata:{license:z.string().max(4000).parse(String(form.get('license')||''))},width:inspected.width,height:inspected.height}
 const replacesAssetId=form.get('replacesAssetId')?z.string().uuid().parse(form.get('replacesAssetId')):null
 const input={contentHash:inspected.contentHash,size:file.size,mimeType:file.type,extension:inspected.extension,metadata,...(replacesAssetId?{replacesAssetId,expectedRevision:z.coerce.number().int().positive().parse(form.get('expectedRevision')),reason:z.string().trim().min(3).max(2000).parse(form.get('reason'))}:{})}
 const args={p_id:requestId,p_property_id:propertyId,p_actor_id:actorId}
 const started=await assetLibraryRpc('begin_forgestudio_asset_upload',{...args,p_input:input})
 if(started.state!=='prepared')return started
 const db=createServiceClient(),storage=db.storage.from(STORAGE_BUCKETS.PROPERTY_ASSETS),path=String(started.storagePath)
 if(!started.duplicateAssetId){
  const {error}=await storage.upload(path,inspected.bytes,{contentType:file.type,upsert:false})
  if(error)await verifyStoredAsset(path,inspected.contentHash,file.size)
 }
 return assetLibraryRpc('finish_forgestudio_asset_upload',{...args,p_payload:{contentHash:inspected.contentHash,storagePath:path,storageBucket:STORAGE_BUCKETS.PROPERTY_ASSETS,storageVerified:!started.duplicateAssetId,fileUrl:storage.getPublicUrl(path).data.publicUrl}})
}
async function verifyStoredAsset(path:string,hash:string,size:number){
 const {data,error}=await createServiceClient().storage.from(STORAGE_BUCKETS.PROPERTY_ASSETS).download(path)
 if(error||!data||data.size!==size||createHash('sha256').update(Buffer.from(await data.arrayBuffer())).digest('hex')!==hash)throw new ContentStoreError('The stored file could not be confirmed. Re-select the same file to retry, or recover this upload from the saved requests.',503)
}
export async function recoverLibraryUpload(input:{requestId:string;propertyId:string;actorId:string;uploadId:string;action:'recover'|'keep_separate';reason:string}){
 const decision={uploadId:input.uploadId,action:input.action,reason:input.reason}
 const args={p_id:input.requestId,p_property_id:input.propertyId,p_actor_id:input.actorId}
 const previous=await assetLibraryRpc('forgestudio_command_start',{...args,p_kind:'asset.upload.recovered',p_payload:decision},['new','replayed'])
 if(previous.state==='replayed')return previous
 const db=createServiceClient(),{data:upload,error}=await db.from('forgestudio_asset_uploads').select('*').eq('id',input.uploadId).eq('property_id',input.propertyId).eq('actor_id',input.actorId).single()
 if(error||!upload)throw new ContentStoreError('Your saved upload could not be loaded.',503)
 const saved=upload.input as {contentHash:string;size:number}
 const {data:duplicate,error:duplicateError}=await db.from('content_assets').select('id').eq('property_id',input.propertyId).eq('content_hash',saved.contentHash).maybeSingle()
 if(duplicateError)throw new ContentStoreError('The library could not be checked. Reload before recovering.',503)
 if(!duplicate&&upload.state!=='completed')await verifyStoredAsset(upload.storage_path,saved.contentHash,saved.size)
 const storage={contentHash:saved.contentHash,storagePath:upload.storage_path,storageBucket:STORAGE_BUCKETS.PROPERTY_ASSETS,storageVerified:!duplicate,fileUrl:db.storage.from(STORAGE_BUCKETS.PROPERTY_ASSETS).getPublicUrl(upload.storage_path).data.publicUrl}
 return assetLibraryRpc('recover_forgestudio_asset_upload',{...args,p_payload:{...decision,storage}})
}
