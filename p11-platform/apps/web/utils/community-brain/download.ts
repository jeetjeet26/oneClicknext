import 'server-only'
import {createHash} from 'node:crypto'
import {createServiceClient} from '@/utils/supabase/admin'
import {brainRpc,requireCurrentScope} from './server'
import {BrainError,type CommunityScope} from './contracts'
export type SavedAsset={id:string;propertyId:string;name:string;bucket:string;path:string;hash:string;format:string;revision:number}
export async function assertAssetCurrent(scope:CommunityScope,asset:SavedAsset){
  await requireCurrentScope(scope,asset.propertyId)
  const current=await brainRpc<SavedAsset>('brain_read_asset',{p_scope_id:scope.id,p_asset_id:asset.id})
  if(current.propertyId!==asset.propertyId||current.hash!==asset.hash||current.revision!==asset.revision||current.path!==asset.path||current.bucket!==asset.bucket)throw new BrainError('The asset changed during this download.',409)
}
export async function downloadCheckedAsset(scope:CommunityScope,propertyId:string,assetId:string,maxBytes=100*1024*1024){
  await requireCurrentScope(scope,propertyId)
  const asset=await brainRpc<SavedAsset>('brain_read_asset',{p_scope_id:scope.id,p_asset_id:assetId})
  if(asset.id!==assetId||asset.propertyId!==propertyId)throw new BrainError('Asset ownership does not match the selected community.',403)
  const {data,error}=await createServiceClient().storage.from(asset.bucket).download(asset.path)
  if(error||!data)throw new BrainError('The retained asset could not be read.')
  if(data.size>maxBytes)throw new BrainError('The selected files exceed this transfer limit. Download fewer files.',413)
  const bytes=Buffer.from(await data.arrayBuffer())
  if(createHash('sha256').update(bytes).digest('hex')!==asset.hash)throw new BrainError('Asset bytes changed. Review its original before using it.',409)
  await assertAssetCurrent(scope,asset)
  return {asset,bytes,mime:data.type||'application/octet-stream'}
}
