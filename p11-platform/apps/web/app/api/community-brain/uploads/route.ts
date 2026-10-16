import {z} from 'zod'
import {createHash} from 'node:crypto'
import {createServiceClient} from '@/utils/supabase/admin'
import {fileRpc,readFiles,verifyOriginal,decideFile} from '@/utils/knowledge/file-store'
import type {FileDetail} from '@/utils/knowledge/file-contracts'
import {brainActor,resolveCommunityScope,requireCurrentScope} from '@/utils/community-brain/server'
import {BrainError} from '@/utils/community-brain/contracts'
import {intakeFormat,intakeFormats} from '@/utils/community-brain/formats'
import {boundedJson,brainFailure,privateHeaders,requireConsoleOrigin} from '@/utils/community-brain/http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const command=z.discriminatedUnion('operation',[
  z.object({operation:z.literal('prepare'),propertyId:z.guid(),requestId:z.guid(),fileName:z.string().max(255),size:z.number().int().positive(),byteHash:z.string().regex(/^[a-f0-9]{64}$/),title:z.string().trim().min(1).max(300),reason:z.string().trim().min(3).max(2000)}).strict(),
  z.object({operation:z.literal('finalize'),propertyId:z.guid(),fileId:z.guid()}).strict(),
])
export async function GET(){return Response.json({recipe:'community-file-v1',formats:intakeFormats},{headers:privateHeaders})}
export async function POST(request:Request) {
  try {
    requireConsoleOrigin(request)
    const actor=await brainActor(),parsed=command.safeParse(await boundedJson(request))
    if(!parsed.success)throw new BrainError('Provide the file identity and selected community.',400)
    const input=parsed.data,scope=await resolveCommunityScope(actor,input.propertyId,'ingestion')
    if(input.operation==='prepare') {
      let spec:ReturnType<typeof intakeFormat>
      try{spec=intakeFormat(input.fileName,input.size)}catch(error){throw new BrainError(error instanceof Error?error.message:'Unsupported file.',400)}
      await fileRpc('begin_knowledge_file',{p_id:input.requestId,p_property_id:input.propertyId,p_actor_id:actor,p_input:{title:input.title,fileName:input.fileName,mimeType:spec.mime,size:input.size,byteHash:input.byteHash,reason:input.reason,materialId:null}})
      const saved=await readFiles(actor,input.propertyId,{kind:'file',fileId:input.requestId}) as unknown as FileDetail
      if(saved.file.state!=='pending')return Response.json({state:saved.file.state,fileId:saved.file.id},{headers:privateHeaders})
      if(saved.file.actor_id!==actor||saved.file.input.byteHash!==input.byteHash)throw new BrainError('This upload belongs to a different saved request.',409)
      const storageClient=createServiceClient();const {data,error}=await storageClient.storage.from('knowledge-originals').createSignedUploadUrl(saved.file.storage_path,{upsert:false})
      if(error||!data)throw new BrainError('The upload could not be prepared.')
      await requireCurrentScope(scope,input.propertyId)
      return Response.json({state:'prepared',fileId:saved.file.id,bucket:'knowledge-originals',path:saved.file.storage_path,token:data.token,signedUrl:data.signedUrl,mimeType:spec.mime},{headers:privateHeaders})
    }
    const saved=await readFiles(actor,input.propertyId,{kind:'file',fileId:input.fileId}) as unknown as FileDetail
    if(saved.file.actor_id!==actor||saved.file.state==='stopped')throw new BrainError('This original cannot be finalized by this request.',409)
    await verifyOriginal(saved.file)
    await requireCurrentScope(scope,input.propertyId)
    await fileRpc('finish_knowledge_file_storage',{p_id:input.fileId,p_actor_id:actor,p_byte_hash:saved.file.input.byteHash,p_size:saved.file.input.size})
    const current=await readFiles(actor,input.propertyId,{kind:'file',fileId:input.fileId}) as unknown as FileDetail
    if(current.file.latest_extraction_id)return Response.json({state:current.extraction?.state??'queued',fileId:input.fileId,extractionId:current.file.latest_extraction_id},{headers:privateHeaders})
    const hash=createHash('sha256').update('community-extract:'+input.fileId).digest('hex'),requestId=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`
    const extraction=await decideFile(actor,{requestId,propertyId:input.propertyId,fileId:input.fileId,expectedRevision:current.file.revision,reason:'Extract the retained community original for review',operation:'extract'})
    return Response.json({...extraction,fileId:input.fileId},{headers:privateHeaders})
  }catch(error){return brainFailure(error)}
}
