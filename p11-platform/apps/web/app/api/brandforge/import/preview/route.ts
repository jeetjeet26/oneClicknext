import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'
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
  sourceIds: z.array(z.string().uuid()).max(50).optional(),
  manual: z.record(z.string(), z.unknown()).optional(),
}).refine(
  value => Boolean(value.websiteUrl || value.documentIds?.length || value.sourceIds?.length || value.manual),
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

export async function GET(request: NextRequest) {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return NextResponse.json({error:'Unauthorized'},{status:401})
  const property = z.guid().safeParse(request.nextUrl.searchParams.get('propertyId'))
  if (!property.success) return NextResponse.json({error:'Valid property required'},{status:400})
  if (!(await validatePropertyAccess(user.id,property.data)).authorized) return NextResponse.json({error:'Forbidden'},{status:403})
  const service = createServiceClient()
  const [brand, imports] = await Promise.all([
    service.from('property_brand_assets').select('*').eq('property_id',property.data).maybeSingle(),
    service.from('property_brand_imports').select('id,created_at,source_type,extracted_contract,conflicts,extraction_report').eq('property_id',property.data).eq('status','needs_review').order('created_at',{ascending:false}).limit(20),
  ])
  if (brand.error || imports.error) return NextResponse.json({error:'Saved import reviews could not be loaded.'},{status:503})
  const revision = brand.data ? Number((brand.data as unknown as {revision:number}).revision) : 0
  const previews = (imports.data || []).filter(item => item.extraction_report && typeof item.extraction_report==='object' && !Array.isArray(item.extraction_report) && item.extraction_report.baseRevision===revision).map(item => ({id:item.id,created_at:item.created_at,source_type:item.source_type,extracted_contract:item.extracted_contract,conflicts:item.conflicts}))
  return NextResponse.json({previews},{headers:{'Cache-Control':'no-store'}})
}
