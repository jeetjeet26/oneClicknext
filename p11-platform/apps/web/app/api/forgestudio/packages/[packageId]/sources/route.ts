import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {ContentStoreError} from '@/utils/forgestudio/content-store'
import {getSourceReview,refreshSourceReview} from '@/utils/forgestudio/source-store'
import {revisionContentSchema} from '@/utils/forgestudio/content-contract'
type Context={params:Promise<{packageId:string}>}
const bodySchema=z.object({requestId:z.string().uuid(),expectedRevisionId:z.string().uuid(),previewHash:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(3).max(2000),content:revisionContentSchema,extraAssetIds:z.array(z.string().uuid()).max(50).default([])})
async function scope(packageId:string){
 if(!z.string().uuid().safeParse(packageId).success)throw new ContentStoreError('Invalid campaign',400)
 const auth=await createClient(),{data:{user},error}=await auth.auth.getUser()
 if(error||!user)throw new ContentStoreError('Unauthorized',401)
 const {data:pkg,error:pkgError}=await createServiceClient().from('social_content_packages').select('property_id,org_id').eq('id',packageId).maybeSingle()
 if(pkgError)throw new ContentStoreError('Campaign access could not be checked',503)
 if(!pkg)throw new ContentStoreError('Campaign not found',404)
 const access=await validatePropertyAccess(user.id,pkg.property_id)
 if(!access.authorized||access.orgId!==pkg.org_id)throw new ContentStoreError('Forbidden',403)
 return {propertyId:pkg.property_id,actorId:user.id}
}
const failure=(error:unknown)=>NextResponse.json({error:error instanceof ContentStoreError?error.message:'The source review could not be loaded. Reload before continuing.'},{status:error instanceof ContentStoreError?error.statusCode:503})
export async function GET(_request:NextRequest,context:Context){try{const {packageId}=await context.params;const {propertyId}=await scope(packageId);return NextResponse.json(await getSourceReview(packageId,propertyId,z.array(z.string().uuid()).max(50).parse(new URL(_request.url).searchParams.getAll('assetId'))))}catch(error){return failure(error)}}
export async function POST(request:NextRequest,context:Context){try{
 const {packageId}=await context.params,access=await scope(packageId),parsed=bodySchema.safeParse(await request.json().catch(()=>null))
 if(!parsed.success)return NextResponse.json({error:'Review the content, evidence and reason before saving.'},{status:400})
 return NextResponse.json(await refreshSourceReview({...parsed.data,...access,packageId}),{status:201})
}catch(error){return failure(error)}}
