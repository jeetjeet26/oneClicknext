import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { authorizeSiteForgeWebsite } from '@/utils/siteforge/operations-auth'
import {
  bindRenderedCritiqueEvidence,
  CritiqueEvidenceError,
} from '@/utils/siteforge/critique/evidence'
import { createRenderedAestheticCritique } from '@/utils/siteforge/critique/service'

export const maxDuration = 180

const requestSchema = z
  .object({
    artifactId: z.string().uuid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    certificationEvidenceId: z.string().uuid(),
  })
  .strict()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/critique/[websiteId]'
  )
  ctx.logStart()
  try {
    const { websiteId } = await params
    const parsed = requestSchema.safeParse(
      await request.json().catch(() => null)
    )
    if (!z.string().uuid().safeParse(websiteId).success || !parsed.success) {
      return NextResponse.json(
        { error: 'Exact artifact and certification evidence are required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }

    const auth = await authorizeSiteForgeWebsite(websiteId)
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: ctx.responseHeaders }
      )
    }
    const [websiteResult, artifactResult, certificationResult] =
      await Promise.all([
        auth.service
          .from('property_websites')
          .select('current_artifact_version_id')
          .eq('id', websiteId)
          .eq('org_id', auth.website.org_id)
          .eq('property_id', auth.website.property_id)
          .single(),
        auth.service
          .from('siteforge_blueprint_versions')
          .select('id, content_hash, created_at, blueprint')
          .eq('id', parsed.data.artifactId)
          .eq('website_id', websiteId)
          .eq('org_id', auth.website.org_id)
          .eq('property_id', auth.website.property_id)
          .single(),
        auth.service
          .from('siteforge_certification_evidence')
          .select(
            'id, artifact_id, evidence_hash, binding_hash, report_hash, report, created_at'
          )
          .eq('id', parsed.data.certificationEvidenceId)
          .eq('artifact_id', parsed.data.artifactId)
          .eq('website_id', websiteId)
          .eq('org_id', auth.website.org_id)
          .eq('property_id', auth.website.property_id)
          .single(),
      ])
    if (
      websiteResult.error ||
      artifactResult.error ||
      certificationResult.error ||
      !websiteResult.data ||
      !artifactResult.data ||
      !certificationResult.data
    ) {
      throw new CritiqueEvidenceError(
        'evidence_missing',
        'Exact critique artifact or certification evidence is unavailable'
      )
    }
    if (
      websiteResult.data.current_artifact_version_id !== artifactResult.data.id ||
      artifactResult.data.content_hash !== parsed.data.contentHash
    ) {
      throw new CritiqueEvidenceError(
        'artifact_mismatch',
        'Critique requires the current exact immutable artifact'
      )
    }

    const evidence = await bindRenderedCritiqueEvidence({
      artifact: {
        id: artifactResult.data.id,
        contentHash: artifactResult.data.content_hash,
        createdAt: artifactResult.data.created_at,
        blueprint: artifactResult.data.blueprint,
      },
      certification: certificationResult.data,
      screenshotLoader: async descriptor => {
        const { data, error } = await auth.service.storage
          .from('siteforge-artifacts')
          .download(descriptor.storagePath)
        if (error || !data) {
          throw new CritiqueEvidenceError(
            'screenshot_missing',
            `Certified screenshot is unavailable: ${descriptor.storagePath}`
          )
        }
        return new Uint8Array(await data.arrayBuffer())
      },
    })
    const report = await createRenderedAestheticCritique({ evidence })
    ctx.logSuccess(200, {
      websiteId,
      artifactId: report.binding.artifactId,
      findings: report.findings.length,
      proposals: report.proposals.length,
      providerStatus: report.provider.status,
    })
    return NextResponse.json(
      { report },
      {
        headers: {
          ...ctx.responseHeaders,
          'Cache-Control': 'private, no-store',
        },
      }
    )
  } catch (error) {
    const status =
      error instanceof CritiqueEvidenceError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof CritiqueEvidenceError
            ? error.message
            : 'Failed to critique certified rendered evidence',
        ...(error instanceof CritiqueEvidenceError
          ? { code: error.code }
          : {}),
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
