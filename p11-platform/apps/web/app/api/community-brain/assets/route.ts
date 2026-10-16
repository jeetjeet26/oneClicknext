import {z} from 'zod'
import {brainActor,resolveCommunityScope} from '@/utils/community-brain/server'
import {BrainError} from '@/utils/community-brain/contracts'
import {downloadCheckedAsset} from '@/utils/community-brain/download'
import {brainFailure,privateHeaders} from '@/utils/community-brain/http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const query=z.object({propertyId:z.guid(),assetId:z.guid(),download:z.enum(['true','false']).default('false')}).strict()
export async function GET(request:Request) {
  try {
    const actor=await brainActor(),parsed=query.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if(!parsed.success)throw new BrainError('Choose the exact community asset.',400)
    const {propertyId,assetId}=parsed.data,scope=await resolveCommunityScope(actor,propertyId,'download')
    const {asset,bytes,mime}=await downloadCheckedAsset(scope,propertyId,assetId)
    const activeType=['image/svg+xml','text/html'].includes(mime)
    return new Response(bytes,{headers:{...privateHeaders,'Content-Type':mime,'Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':`${parsed.data.download==='true'||activeType?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(asset.name)}`}})
  }catch(error){return brainFailure(error)}
}
