import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { confirmBrandImport } from '@/utils/brandforge/imports'
import { createRequestContext } from '@/utils/services/request-context'

const confirmSchema = z.object({
  propertyId: z.guid(),
  importId: z.string().uuid(),
  contract: z.record(z.string(), z.unknown()).optional(),
  resolutions: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/brandforge/import/confirm')
  ctx.logStart()
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
    }
    const parsed = confirmSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid brand confirmation request',
        details: parsed.error.flatten(),
      }, { status: 400, headers: ctx.responseHeaders })
    }
    const access = await validatePropertyManagerAccess(user.id, parsed.data.propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })
    }
    const result = await confirmBrandImport({
      ...parsed.data,
      userId: user.id,
    })
    ctx.logSuccess(200, { brandAssetId: result.brandAssetId })
    return NextResponse.json(result, { headers: ctx.responseHeaders })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Brand import confirmation failed'
    const status = message.startsWith('Resolve import conflicts')
      || message.includes('unapproved or rights-blocked')
      || message.includes('rights-cleared')
      ? 409
      : 500
    ctx.logError(status, error)
    return NextResponse.json({ error: message }, { status, headers: ctx.responseHeaders })
  }
}
