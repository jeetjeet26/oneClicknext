import {NextRequest,NextResponse} from 'next/server'
import {createClient} from '@/utils/supabase/server'
import {badRequest,forbidden,serverError,unauthorized} from '@/utils/services/api-helpers'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {createRequestContext} from '@/utils/services/request-context'
import {revokeIntegrationAuthInvite} from '@/utils/services/integration-auth-invites'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export async function DELETE(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const ctx=createRequestContext(request,'/api/lumaleasing/integration-invites/[id]');ctx.logStart()
 try {
  const client=await createClient(),{data:{user},error}=await client.auth.getUser()
  if(error||!user)return unauthorized(ctx.responseHeaders)
  const {id}=await params,body=await request.json().catch(()=>null)
  if(!uuid.test(id)||!body||typeof body.propertyId!=='string'||!uuid.test(body.propertyId)||typeof body.requestId!=='string'||!uuid.test(body.requestId))return badRequest('A property and saved request identity are required.',ctx.responseHeaders)
  const access=await validatePropertyAccess(user.id,body.propertyId)
  if(!access.authorized)return forbidden(ctx.responseHeaders)
  const result=await revokeIntegrationAuthInvite({propertyId:body.propertyId,actorId:user.id,inviteId:id,requestId:body.requestId})
  ctx.logSuccess(200,{propertyId:body.propertyId,inviteId:id,state:result.state})
  return NextResponse.json({...result,success:result.state==='revoked',...(result.state==='already_used'?{error:'This link was already used. Remove the connected account separately if needed.'}:{})},{status:result.state==='already_used'?409:200,headers:ctx.responseHeaders})
 }catch(error){ctx.logError(500,error,{operation:'revoke_integration_invite'});return serverError(error,ctx.responseHeaders)}
}
