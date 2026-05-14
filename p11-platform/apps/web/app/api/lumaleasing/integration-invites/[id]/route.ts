import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { forbidden, notFound, serverError, unauthorized } from '@/utils/services/api-helpers'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = createRequestContext(request, '/api/lumaleasing/integration-invites/[id]')
  ctx.logStart()

  try {
    const { id } = await params
    const serviceSupabase = createServiceClient()
    const { data: invite, error: inviteError } = await serviceSupabase
      .from('integration_auth_invites')
      .select('id, property_id')
      .eq('id', id)
      .maybeSingle()

    if (inviteError || !invite) {
      ctx.logSuccess(404, { reason: 'invite_not_found', inviteId: id })
      return notFound('Invite', ctx.responseHeaders)
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, invite.property_id)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId: invite.property_id, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const { error: updateError } = await serviceSupabase
      .from('integration_auth_invites')
      .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)

    if (updateError) {
      ctx.logError(500, updateError, { operation: 'revoke_integration_invite', inviteId: id })
      return serverError(updateError, ctx.responseHeaders)
    }

    ctx.logSuccess(200, { inviteId: id, propertyId: invite.property_id })
    return NextResponse.json({ success: true }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'revoke_integration_invite' })
    return serverError(error, ctx.responseHeaders)
  }
}
