import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createBrandImportPreview } from '@/utils/brandforge/imports'
import { createRequestContext } from '@/utils/services/request-context'

const previewSchema = z.object({
  propertyId: z.guid(),
  sourceType: z.enum(['package', 'website', 'manual', 'hybrid']),
  idempotencyKey: z.string().min(8).max(200),
  websiteUrl: z.url().optional(),
  documentIds: z.array(z.string().uuid()).max(50).optional(),
  manual: z.record(z.string(), z.unknown()).optional(),
}).refine(
  value => Boolean(value.websiteUrl || value.documentIds?.length || value.manual),
  'At least one import source is required',
)

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/brandforge/import/preview')
  ctx.logStart()
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
    }
    const parsed = previewSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid brand import request',
        details: parsed.error.flatten(),
      }, { status: 400, headers: ctx.responseHeaders })
    }
    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized || !access.orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })
    }
    const preview = await createBrandImportPreview({
      ...parsed.data,
      orgId: access.orgId,
      userId: user.id,
    })
    ctx.logSuccess(200, { importId: preview.id })
    return NextResponse.json({ preview }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Brand import preview failed',
    }, { status: 500, headers: ctx.responseHeaders })
  }
}
