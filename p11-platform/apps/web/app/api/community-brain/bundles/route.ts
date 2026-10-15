import {createHash,randomUUID} from 'node:crypto'
import {zipSync,strToU8} from 'fflate'
import {z} from 'zod'
import {brainActor,brainRpc,resolvePortfolioScope,requireCurrentScope} from '@/utils/community-brain/server'
import {BrainError} from '@/utils/community-brain/contracts'
import {downloadCheckedAsset,assertAssetCurrent,type SavedAsset} from '@/utils/community-brain/download'
import {boundedJson,brainFailure,privateHeaders,requireConsoleOrigin} from '@/utils/community-brain/http'
export const runtime='nodejs'
export const maxDuration=300
const schema=z.object({sessionId:z.uuid(),propertyIds:z.array(z.uuid()).min(1).max(500),assets:z.array(z.object({propertyId:z.uuid(),assetId:z.uuid()}).strict()).min(1).max(50)}).strict()
export async function POST(request:Request){try{
 requireConsoleOrigin(request)
 const input=schema.parse(await boundedJson(request)),actor=await brainActor(),scope=await resolvePortfolioScope(actor,input.propertyIds)
 // Combined history must remain authorized too; a session cannot change its contributors.
 await brainRpc('brain_portfolio_history',{p_scope_id:scope.id,p_session_id:input.sessionId})
 const files:Record<string,Uint8Array>={},manifest:Array<{propertyId:string;assetId:string;name:string;path:string;sha256:string;revision:number;bytes:number}>=[],retained:SavedAsset[]=[]
 let bytes=0
 for(const item of input.assets){
  if(!scope.property_ids.includes(item.propertyId))throw new BrainError('This asset is outside the selected communities.',403)
  if(retained.some(a=>a.id===item.assetId))continue
  const value=await downloadCheckedAsset(scope,item.propertyId,item.assetId,50*1024*1024-bytes)
  const extension=/^[a-z0-9]{1,8}$/i.test(value.asset.format)?value.asset.format:'bin'
  const path=`${item.propertyId}/${item.assetId}.${extension}`
  bytes+=value.bytes.length;files[path]=value.bytes;retained.push(value.asset)
  manifest.push({propertyId:item.propertyId,assetId:item.assetId,name:value.asset.name,path,sha256:value.asset.hash,revision:value.asset.revision,bytes:value.bytes.length})
 }
 files['manifest.json']=strToU8(JSON.stringify({version:1,createdAt:new Date().toISOString(),assets:manifest},null,2))
 const archive=zipSync(files,{level:0}),hash=createHash('sha256').update(archive).digest('hex')
 // Recheck every file after the entire bundle is assembled. One revocation
 // withholds the combined archive rather than silently leaking its old bytes.
 for(const asset of retained)await assertAssetCurrent(scope,asset)
 await requireCurrentScope(scope,scope.property_ids[0])
 await brainRpc('brain_portfolio_append',{p_scope_id:scope.id,p_session_id:input.sessionId,p_id:randomUUID(),p_role:'assistant',p_body:`Exported ${manifest.length} exact assets.`,p_evidence:{propertyIds:scope.property_ids,kind:'asset_export',sha256:hash,bytes:archive.length,assets:manifest}})
 return new Response(Buffer.from(archive),{headers:{...privateHeaders,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="community-assets.zip"'}})
}catch(error){return brainFailure(error)}}
