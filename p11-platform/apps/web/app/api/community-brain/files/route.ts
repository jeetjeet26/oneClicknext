import {createHash} from 'node:crypto'
import {z} from 'zod'
import {brainActor,brainRpc,resolveCommunityScope,requireCurrentScope} from '@/utils/community-brain/server'
import {BrainError} from '@/utils/community-brain/contracts'
import {brainFailure,privateHeaders} from '@/utils/community-brain/http'
import {createServiceClient} from '@/utils/supabase/admin'
export const dynamic='force-dynamic'
export async function GET(request:Request){try{
 const actor=await brainActor(),p=new URL(request.url).searchParams,propertyId=z.guid().parse(p.get('propertyId')),fileId=z.guid().parse(p.get('fileId')),scope=await resolveCommunityScope(actor,propertyId,'download')
 const detail=await brainRpc<{sourceCurrent:boolean;file:{property_id:string;state:string;storage_path:string;input:{byteHash:string;fileName:string;mimeType:string;size:number}}}>('brain_file_detail',{p_scope_id:scope.id,p_file_id:fileId})
 if(detail.file.property_id!==propertyId||detail.file.state!=='stored'||!detail.sourceCurrent)throw new BrainError('Original file is unavailable.',404)
 let path=detail.file.storage_path,hash=detail.file.input.byteHash,size=detail.file.input.size,mime=detail.file.input.mimeType
 if(p.get('renditionId')){
  // The generated schema is refreshed from the qualified migration before release.
  const query=createServiceClient().from('community_file_renditions').select('*').eq('id',z.guid().parse(p.get('renditionId'))).eq('file_id',fileId).eq('property_id',propertyId)
  const {data,error}=await query.single();if(error||!data||data.original_hash!==hash)throw new BrainError('The selected page is unavailable.',404)
  path=data.storage_path;hash=data.content_hash;size=data.byte_size;mime=data.mime_type
 }
 if(!path.startsWith(propertyId+'/'+fileId+'/'))throw new BrainError('File ownership is inconsistent.',409)
 const storageClient=createServiceClient();const {data,error}=await storageClient.storage.from('knowledge-originals').download(path)
 if(error||!data||data.size!==size||size>104857600)throw new BrainError('The retained file could not be confirmed.')
 const bytes=await data.arrayBuffer();if(createHash('sha256').update(new Uint8Array(bytes)).digest('hex')!==hash)throw new BrainError('Retained file checksum changed.',409)
 await requireCurrentScope(scope,propertyId)
 const latest=await brainRpc<typeof detail>('brain_file_detail',{p_scope_id:scope.id,p_file_id:fileId})
 if(latest.file.state!=='stored'||!latest.sourceCurrent||latest.file.input.byteHash!==detail.file.input.byteHash)throw new BrainError('The original changed during this download.',409)
 const inline=p.get('renditionId')&&['image/png','image/webp','image/jpeg'].includes(mime)
 return new Response(bytes,{headers:{...privateHeaders,'Content-Type':mime,'Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':`${inline?'inline':'attachment'}; filename="${detail.file.input.fileName.replace(/[^a-zA-Z0-9._-]/g,'_')}"`}})
}catch(error){return brainFailure(error)}}
