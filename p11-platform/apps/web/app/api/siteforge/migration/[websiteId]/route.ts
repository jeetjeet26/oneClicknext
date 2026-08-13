import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { getDataEngineUrl } from '@/utils/services/runtime-config'
import {
  createMigrationManifest,
  listMigrationManifests,
  SiteForgeMigrationError,
} from '@/utils/siteforge/migration/repository'

const propertyIdSchema = z.guid()
const manifestCaptureSchema = z
  .object({
    propertyId: propertyIdSchema,
    crawlId: z.guid(),
    targetUrl: z
      .url()
      .refine(value => ['http:', 'https:'].includes(new URL(value).protocol)),
  })
  .strict()

async function captureCrawlerManifest(input: z.infer<typeof manifestCaptureSchema>) {
  const response = await fetch(`${getDataEngineUrl()}/jobs/siteaudit/manifest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.DATA_ENGINE_API_KEY || '',
      'X-Correlation-ID': input.crawlId,
    },
    body: JSON.stringify({
      crawl_id: input.crawlId,
      target_url: input.targetUrl,
    }),
    cache: 'no-store',
  })
  const body: unknown = await response.json().catch(() => null)
  if (
    !response.ok
    || !body
    || typeof body !== 'object'
    || !('manifest' in body)
  ) {
    throw new SiteForgeMigrationError(
      'Failed to generate migration manifest from the completed source crawl',
      response.status >= 400 && response.status < 500 ? response.status : 502
    )
  }
  const manifest = (body as { manifest: Record<string, unknown> }).manifest
  if (manifest.propertyId !== input.propertyId) {
    throw new SiteForgeMigrationError(
      'The source crawl does not belong to this property',
      403
    )
  }
  return manifest
}

async function authorize(request: NextRequest, propertyId: string) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Unauthorized' as const, status: 401 }
  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized) return { error: 'Forbidden' as const, status: 403 }
  return { user }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/migration/[websiteId]'
  )
  ctx.logStart()
  try {
    const { websiteId } = await params
    const propertyId = request.nextUrl.searchParams.get('propertyId')
    if (
      !z.string().uuid().safeParse(websiteId).success ||
      !propertyIdSchema.safeParse(propertyId).success
    ) {
      return NextResponse.json(
        { error: 'Invalid migration scope' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await authorize(request, propertyId!)
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: ctx.responseHeaders }
      )
    }
    const manifests = await listMigrationManifests(websiteId, propertyId!)
    ctx.logSuccess(200, { websiteId, count: manifests.length })
    return NextResponse.json({ manifests }, { headers: ctx.responseHeaders })
  } catch (error) {
    const status =
      error instanceof SiteForgeMigrationError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof SiteForgeMigrationError
            ? error.message
            : 'Failed to load migration manifests',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/migration/[websiteId]'
  )
  ctx.logStart()
  try {
    const { websiteId } = await params
    if (!z.string().uuid().safeParse(websiteId).success) {
      return NextResponse.json(
        { error: 'Invalid website identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const body: unknown = await request.json()
    const propertyId =
      body && typeof body === 'object' && 'propertyId' in body
        ? (body as { propertyId?: unknown }).propertyId
        : null
    if (!propertyIdSchema.safeParse(propertyId).success) {
      return NextResponse.json(
        { error: 'Invalid property identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await authorize(request, String(propertyId))
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: ctx.responseHeaders }
      )
    }
    const capture = manifestCaptureSchema.safeParse(body)
    const manifestInput = capture.success
      ? await captureCrawlerManifest(capture.data)
      : body
    const manifest = await createMigrationManifest({
      websiteId,
      userId: auth.user.id,
      manifest: manifestInput,
    })
    ctx.logSuccess(201, { websiteId, manifestId: manifest.id })
    return NextResponse.json(
      { success: true, manifest },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    const validation = error instanceof z.ZodError
    const status = validation
      ? 400
      : error instanceof SiteForgeMigrationError
        ? error.statusCode
        : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error: validation
          ? 'Invalid migration manifest'
          : error instanceof SiteForgeMigrationError
            ? error.message
            : 'Failed to create migration manifest',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
