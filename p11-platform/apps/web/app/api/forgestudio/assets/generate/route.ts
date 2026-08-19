import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const legacyRequestSchema = z.object({
  propertyId: z.string().min(1),
}).passthrough()

/**
 * Direct synchronous Vertex generation is retired. The replacement creates a
 * leased, idempotent shared job with Gateway model policy and governed storage.
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
      error: 'Legacy synchronous media generation is retired.',
      replacement: '/api/forgestudio/media-jobs',
    },
    { status: 410 }
  )
}
