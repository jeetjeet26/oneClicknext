/** Local synthetic Storage export/removal. Database metadata is never used as a deletion substitute. */
import {createClient} from '@supabase/supabase-js'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,join} from 'node:path'
const [operation,bundlePath,receiptPath,neighborProperty]=process.argv.slice(2)
if(!['export','remove'].includes(operation)||!bundlePath)throw new Error('Choose export/remove and the exact local export directory')
const url=process.env.NEXT_PUBLIC_SUPABASE_URL
if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw new Error('Local Supabase only')
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const folder=resolve(bundlePath),source=JSON.parse(await readFile(join(folder,'private-rehearsal-snapshot.json'),'utf8'))
const hash=b=>createHash('sha256').update(b).digest('hex')
const write=async(name,value)=>writeFile(join(folder,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600})
const checked=async query=>{const r=await query;if(r.error)throw new Error(r.error.message);return r.data}
const organization=await checked(db.from('organizations').select('name').eq('id',source.org).single())
if(source.source!=='synthetic_local'||!organization.name.startsWith('Synthetic lifecycle '))throw new Error('Named synthetic lifecycle client required')
const properties=(await checked(db.from('properties').select('id').eq('org_id',source.org))).map(x=>x.id)
const files=source.rows.filter(r=>r.table==='public.knowledge_files').map(r=>r.data)
for(const file of files){
 if(!properties.includes(file.property_id)||file.org_id!==source.org||!file.storage_path.startsWith(file.property_id+'/'))throw new Error('File scope changed')
 const current=await checked(db.from('knowledge_files').select('input,storage_path').eq('id',file.id).eq('property_id',file.property_id).single())
 if(current.storage_path!==file.storage_path||current.input.byteHash!==file.input.byteHash)throw new Error('Original identity changed')
}
// Refuse to imply that other stored assets or unrecognized paths were handled.
const unsupported=source.rows.filter(r=>r.data.storage_path&&r.table!=='public.knowledge_files')
if(unsupported.length)throw new Error('Additional stored asset families require a scoped Storage adapter before offboarding')
async function download(path){return Buffer.from(await (await checked(db.storage.from('knowledge-originals').download(path))).arrayBuffer())}
async function absent(error){
 if(!error)return false
 if(/not found/i.test(error.message??'')&&String(error.statusCode??error.status)==='404')return true
 // Storage can wrap a structured missing-object response in StorageUnknownError.
 // Do not mistake an authorization, network or generic HTTP 400 error for absence.
 const response=error.originalError
 if(!(response instanceof Response))return false
 try{const body=await response.clone().json();return String(body.statusCode)==='404'&&body.code==='NoSuchKey'}catch{return false}
}
async function neighborHash(){
 if(!neighborProperty)return null
 if(properties.includes(neighborProperty))throw new Error('Neighbor must be a different client property')
 const rows=await checked(db.from('knowledge_files').select('id,storage_path,org_id').eq('property_id',neighborProperty))
 if(!rows.length||rows.some(r=>r.org_id===source.org))throw new Error('A neighboring original from another client is required')
 return Promise.all(rows.map(async r=>({id:r.id,sha256:hash(await download(r.storage_path))})))
}
if(operation==='export'){
 await mkdir(join(folder,'originals'),{recursive:false,mode:0o700})
 const saved=[]
 for(const file of files){
  const bytes=await download(file.storage_path),sha256=hash(bytes)
  if(sha256!==file.input.byteHash||bytes.length!==file.input.size)throw new Error('Original bytes differ from the retained file evidence')
  await writeFile(join(folder,'originals',file.id+'.bin'),bytes,{flag:'wx',mode:0o600})
  saved.push({id:file.id,bucket:'knowledge-originals',path:file.storage_path,sha256,bytes:bytes.length,exportFile:'originals/'+file.id+'.bin'})
 }
 await write('storage-export.json',{source:'synthetic_local',org:source.org,sourceHash:source.contentHash,files:saved,externalReferences:source.rows.filter(r=>r.data.file_url&&!r.data.storage_path).map(r=>({table:r.table,id:r.data.id,state:'external_reference_only',url:r.data.file_url})),neighbor:await neighborHash()})
 console.log(JSON.stringify({state:'original_bytes_exported',files:saved.length}))
}else{
 const receipt=JSON.parse(await readFile(receiptPath,'utf8')),manifest=JSON.parse(await readFile(join(folder,'storage-export.json'),'utf8'))
 if(receipt.state!=='local_clone_erased'||receipt.org!==source.org||receipt.exportSourceHash!==manifest.sourceHash||!/^phase6_client_lifecycle_\d{8}(?:_[a-z]+)?$/.test(receipt.database))throw new Error('The exact isolated database erasure receipt is required')
 const originals=new Map(files.map(f=>[f.id,f]))
 if(manifest.org!==source.org||manifest.sourceHash!==source.contentHash||manifest.files.length!==files.length)throw new Error('Storage inventory differs from the exact client export')
 for(const file of manifest.files){const original=originals.get(file.id);if(!original||file.bucket!=='knowledge-originals'||file.path!==original.storage_path||file.sha256!==original.input.byteHash||file.bytes!==original.input.size||file.exportFile!=='originals/'+file.id+'.bin')throw new Error('Unexpected Storage deletion target')}
 const before=await neighborHash(),verified=[]
 if(JSON.stringify(before)!==JSON.stringify(manifest.neighbor))throw new Error('Neighbor original changed before removal')
 // Validate every retained export before removing any source bytes.
 for(const file of manifest.files){if(hash(await readFile(join(folder,file.exportFile)))!==file.sha256)throw new Error('Exported original changed')}
 const intent={org:source.org,sourceHash:source.contentHash,files:manifest.files}
 try{await write('storage-removal-intent.json',intent)}catch(error){if(error.code!=='EEXIST')throw error;const prior=JSON.parse(await readFile(join(folder,'storage-removal-intent.json'),'utf8'));if(JSON.stringify(prior)!==JSON.stringify(intent))throw new Error('Saved removal intent changed')}
 for(const file of manifest.files){
  const original=await db.storage.from(file.bucket).download(file.path)
  if(original.error&&!await absent(original.error))throw new Error('Source byte state is unavailable')
  if(original.data){const bytes=Buffer.from(await original.data.arrayBuffer());if(hash(bytes)!==file.sha256)throw new Error('Source original changed after export');await checked(db.storage.from(file.bucket).remove([file.path]))}
  const missing=await db.storage.from(file.bucket).download(file.path)
  if(!await absent(missing.error))throw new Error('Byte absence could not be verified')
  verified.push({...file,state:'absence_verified_after_recorded_intent'})
 }
 const after=await neighborHash();if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Neighbor byte verification failed')
 await write('storage-removal.json',{source:'synthetic_local',org:source.org,files:verified,neighborUnchanged:true,retainedCopy:'Downloaded client export remains retained under the explicit test policy.',providerCopies:'none_synthetic',trainingEligible:false})
 console.log(JSON.stringify({state:'local_original_bytes_removed',files:verified.length,neighborUnchanged:true}))
}
