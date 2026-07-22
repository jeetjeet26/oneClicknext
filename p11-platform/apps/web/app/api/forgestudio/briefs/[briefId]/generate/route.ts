import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  assembleForgeStudioContext,
  persistContextSnapshot,
} from '@/utils/forgestudio/context-assembler'
import {
  GenerationClaimError,
  generateRevisionContent,
} from '@/utils/forgestudio/generation'
import {
  ContentStoreError,
  createPackageWithRevision,
  setBriefStatus,
} from '@/utils/forgestudio/content-store'
import { SOCIAL_PLATFORMS, type SocialPlatform } from '@/utils/forgestudio/content-contract'

export const maxDuration = 120

type BriefFacts = Array<{ text: string; source?: string }>

// POST - Generate a content package (one concept, channel variants) from a brief.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ briefId: string }> }
) {
  const { briefId } = await params

  try {
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()
    const { data: brief, error: briefError } = await supabase
      .from('social_content_briefs')
      .select('*')
      .eq('id', briefId)
      .single()

    if (briefError || !brief) {
      return NextResponse.json({ error: 'Brief not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, brief.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const channels = (brief.channels ?? []).filter((channel): channel is SocialPlatform =>
      (SOCIAL_PLATFORMS as readonly string[]).includes(channel)
    )
    if (channels.length === 0) {
      return NextResponse.json(
        { error: 'Brief has no valid channels to generate for' },
        { status: 400 }
      )
    }

    await setBriefStatus(briefId, 'generating')

    try {
      // 1. Assemble the trusted evidence bundle and persist it verbatim.
      const sourceFacts = (Array.isArray(brief.source_facts) ? brief.source_facts : []) as BriefFacts
      const bundle = await assembleForgeStudioContext({
        propertyId: brief.property_id,
        query: [brief.objective, brief.topic].filter(Boolean).join(' — '),
        sourceFacts,
        assetIds: brief.asset_ids ?? [],
      })

      const snapshotId = await persistContextSnapshot({
        orgId: brief.org_id,
        propertyId: brief.property_id,
        bundle,
        sourceRef: `brief:${briefId}`,
        capturedBy: user.id,
      })

      // 2. Structured generation with fail-closed claim checking.
      const generation = await generateRevisionContent({
        bundle,
        objective: brief.objective,
        topic: brief.topic,
        audience: brief.audience,
        constraints: (brief.constraints ?? {}) as Record<string, unknown>,
        channels,
      })

      // 3. Persist as a package with revision 1 (pending approval).
      const { pkg, revision } = await createPackageWithRevision({
        orgId: brief.org_id,
        propertyId: brief.property_id,
        briefId,
        createdBy: user.id,
        content: generation.content,
        author: { kind: 'llm' },
        contextSnapshotId: snapshotId,
        generationMetadata: generation.metadata,
      })

      await setBriefStatus(briefId, 'generated')

      const { data: variants } = await supabase
        .from('social_content_variants')
        .select('*')
        .eq('revision_id', revision.id)

      return NextResponse.json(
        { package: pkg, revision, variants: variants ?? [] },
        { status: 201 }
      )
    } catch (error) {
      await setBriefStatus(briefId, 'draft').catch(() => undefined)

      if (error instanceof GenerationClaimError) {
        return NextResponse.json(
          {
            error: 'Generation blocked: sensitive claims lacked authoritative sources',
            unsupportedClaims: error.unsupportedClaims,
          },
          { status: 422 }
        )
      }
      throw error
    }
  } catch (error) {
    if (error instanceof ContentStoreError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Brief generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Generation failed' },
      { status: 500 }
    )
  }
}
