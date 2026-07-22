import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { ContentStoreError, setRevisionApproval } from '@/utils/forgestudio/content-store'

const approvalSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  note: z.string().max(2000).nullish(),
})

// POST - Approve or deny a pending revision (manager/admin only).
// Approval is bound to the exact immutable revision, never the package.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ revisionId: string }> }
) {
  try {
    const { revisionId } = await params
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const parsed = approvalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid approval request', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const { data: revision, error: revisionError } = await supabase
      .from('social_content_revisions')
      .select('id, property_id')
      .eq('id', revisionId)
      .single()

    if (revisionError || !revision) {
      return NextResponse.json({ error: 'Revision not found' }, { status: 404 })
    }

    const access = await validatePropertyManagerAccess(user.id, revision.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: access.error || 'Forbidden' }, { status: 403 })
    }

    const updated = await setRevisionApproval({
      revisionId,
      decision: parsed.data.decision,
      reviewerId: user.id,
      note: parsed.data.note,
    })

    return NextResponse.json({ revision: updated })
  } catch (error) {
    if (error instanceof ContentStoreError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Revision approval error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
