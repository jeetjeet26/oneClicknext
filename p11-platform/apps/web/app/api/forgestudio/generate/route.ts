import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const legacyRequestSchema = z.object({
  propertyId: z.string().min(1),
}).passthrough()

/**
 * The mutable content_drafts generator is retired. Keep an authenticated,
 * property-scoped tombstone so old clients fail explicitly instead of silently
 * bypassing canonical briefs, context snapshots, revisions, and approvals.
 */
export async function POST(request: NextRequest) {
  const authClient = await createServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = legacyRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Valid propertyId required' }, { status: 400 })
  }
  const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json(
    {
      error: 'Legacy Quick Create is retired. Create a canonical ForgeStudio campaign brief.',
      replacement: '/api/forgestudio/briefs',
    },
    { status: 410 }
  )
}
