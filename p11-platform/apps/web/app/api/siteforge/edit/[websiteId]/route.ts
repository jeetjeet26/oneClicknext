// SiteForge: Edit Website Section API
// POST /api/siteforge/edit/[websiteId]
// Allows LLM-driven editing of specific sections
// Created: December 16, 2025

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { generateBlueprintPatches } from '@/utils/siteforge/llm-patch-generator'
import { applyBlueprintPatch } from '@/utils/siteforge/blueprint'
import type { GeneratedPage, SiteBlueprint } from '@/types/siteforge'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { strictGeneratedPageSchema } from '@/utils/siteforge/block-schemas'
import { validateWordPressThemeArtifact } from '@/utils/siteforge/wordpress/theme-artifact'
import {
  siteForgeAnalyticsConfigSchema,
  siteForgeLegalConfigSchema,
  evaluateDeterministicSiteForgeQuality,
} from '@/utils/siteforge/quality/deterministic-gates'
import type { PhotoManifest } from '@/utils/siteforge/agents/photo-agent'
import type { Json } from '@/types/supabase'
import { createRequestContext } from '@/utils/services/request-context'
import { siteForgePlanSchema } from '@/utils/siteforge/contracts'

const requestSchema = z.object({
  sectionId: z.string().trim().min(1).max(200),
  userIntent: z.string().trim().min(1).max(4_000),
  expectedArtifactId: z.string().uuid(),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(request, '/api/siteforge/edit/[websiteId]')
  ctx.logStart()
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { websiteId } = await params
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid immutable artifact edit request' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const { sectionId, userIntent, expectedArtifactId, expectedContentHash } =
      parsed.data
    
    // Get current blueprint
    const { data: website, error: websiteError } = await supabase
      .from('property_websites')
      .select('blueprint, version, property_id, current_artifact_version_id')
      .eq('id', websiteId)
      .single()
    
    if (websiteError || !website) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 })
    }
    
    if (typeof website.property_id !== 'string') {
      return NextResponse.json({ error: 'Website property mapping is invalid' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, website.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (website.current_artifact_version_id !== expectedArtifactId) {
      return NextResponse.json(
        { error: 'Artifact changed; reload before editing' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const serviceClient = createServiceClient()
    const { data: currentArtifact, error: artifactError } = await serviceClient
      .from('siteforge_blueprint_versions')
      .select(
        'id, blueprint, content_hash, quality_report, runtime_contract_version'
      )
      .eq('id', expectedArtifactId)
      .eq('website_id', websiteId)
      .single()
    if (
      artifactError ||
      !currentArtifact ||
      currentArtifact.content_hash !== expectedContentHash
    ) {
      return NextResponse.json(
        { error: 'Artifact hash changed; reload before editing' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    if (currentArtifact.runtime_contract_version >= 2) {
      return NextResponse.json(
        {
          error:
            'Runtime v2 artifacts must be edited through the semantic editor',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const currentBlueprint = currentArtifact.blueprint as unknown as SiteBlueprint
    
    // Generate patches using LLM
    const patches = await generateBlueprintPatches(
      currentBlueprint,
      sectionId,
      userIntent
    )
    
    // Apply patches to blueprint
    const updatedBlueprint = applyBlueprintPatch(
      currentBlueprint,
      patches
    )
    const blueprintRecord = updatedBlueprint as unknown as Record<string, unknown>
    const currentBlueprintRecord = currentBlueprint as unknown as Record<string, unknown>
    if (
      hashSiteForgeContent(blueprintRecord.brandSnapshot)
        !== hashSiteForgeContent(currentBlueprintRecord.brandSnapshot)
      || hashSiteForgeContent(blueprintRecord.onboardingSnapshot)
        !== hashSiteForgeContent(currentBlueprintRecord.onboardingSnapshot)
    ) {
      return NextResponse.json(
        { error: 'Brand tokens and assets are locked; approve a BrandForge revision first' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const pages = z
      .array(strictGeneratedPageSchema)
      .min(1)
      .parse(blueprintRecord.pages)
    const photoManifest = blueprintRecord.photoManifest
    if (
      !photoManifest ||
      typeof photoManifest !== 'object' ||
      Array.isArray(photoManifest) ||
      !Array.isArray((photoManifest as Record<string, unknown>).photos)
    ) {
      return NextResponse.json(
        { error: 'Edited artifact is missing a valid photo manifest' },
        { status: 422, headers: ctx.responseHeaders }
      )
    }
    const deterministicQualityReport = evaluateDeterministicSiteForgeQuality({
      pages: pages as unknown as GeneratedPage[],
      confirmedPlan: blueprintRecord.confirmedPlan
        ? siteForgePlanSchema.parse(blueprintRecord.confirmedPlan)
        : undefined,
      photoManifest: photoManifest as unknown as PhotoManifest,
      themeArtifact: validateWordPressThemeArtifact(
        blueprintRecord.wordpressThemeArtifact
      ),
      legal: siteForgeLegalConfigSchema.parse(blueprintRecord.legal),
      analytics: siteForgeAnalyticsConfigSchema.parse(
        blueprintRecord.analytics
      ),
    })
    if (!deterministicQualityReport.passed) {
      return NextResponse.json(
        {
          error: 'Edited artifact failed deterministic quality gates',
          qualityReport: deterministicQualityReport,
        },
        { status: 422, headers: ctx.responseHeaders }
      )
    }
    blueprintRecord.deterministicQualityReport = deterministicQualityReport
    blueprintRecord.updatedAt = new Date().toISOString()
    const contentHash = hashSiteForgeContent(blueprintRecord)
    const inheritedAgentQuality =
      currentArtifact.quality_report &&
      typeof currentArtifact.quality_report === 'object' &&
      !Array.isArray(currentArtifact.quality_report)
        ? currentArtifact.quality_report.agent
        : null
    const qualityReport = {
      agent: inheritedAgentQuality,
      deterministic: deterministicQualityReport,
    }
    const { data: revision, error: revisionError } = await serviceClient.rpc(
      'publish_siteforge_artifact_revision',
      {
        p_website_id: websiteId,
        p_expected_artifact_id: expectedArtifactId,
        p_blueprint: blueprintRecord as unknown as Json,
        p_content_hash: contentHash,
        p_change_type: 'edit',
        p_changes_summary: `Edited section ${sectionId}`,
        p_edit_intent: userIntent,
        p_patches_applied: patches as unknown as Json,
        p_quality_report: qualityReport as unknown as Json,
        p_quality_score: 100,
        p_created_by: user.id,
        p_operation_set: patches as unknown as Json,
        p_operation_set_hash: hashSiteForgeContent(patches),
      }
    )
    if (revisionError || !revision) {
      const conflict = revisionError?.message.includes('version conflict')
      return NextResponse.json(
        {
          error: conflict
            ? 'Artifact changed; reload before editing'
            : 'Failed to publish immutable artifact revision',
        },
        { status: conflict ? 409 : 500, headers: ctx.responseHeaders }
      )
    }
    
    // Log edit action
    await serviceClient
      .from('mcp_audit_log')
      .insert({
        platform: 'siteforge-edit',
        tool_name: 'edit_section',
        operation_type: 'siteforge_edit_section',
        property_id: website.property_id,
        parameters: {
          websiteId,
          sectionId,
          userIntent,
          patchCount: patches.length,
          parentArtifactId: expectedArtifactId,
          artifactId: revision.id,
          contentHash,
        },
        success: true,
      })
    
    return NextResponse.json({
      success: true,
      blueprint: updatedBlueprint,
      patches,
      newVersion: revision.version,
      artifactId: revision.id,
      contentHash,
      qualityReport: deterministicQualityReport,
    }, { headers: ctx.responseHeaders })
    
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to edit section' },
      { status: 500 }
    )
  }
}
