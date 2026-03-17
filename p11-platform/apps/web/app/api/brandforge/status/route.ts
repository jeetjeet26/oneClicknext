import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const BRAND_SECTIONS = [
  { step: 1, slug: 'introduction', title: 'Introduction & Market Context', column: 'section_1_introduction' },
  { step: 2, slug: 'positioning', title: 'Positioning Statement', column: 'section_2_positioning' },
  { step: 3, slug: 'target_audience', title: 'Target Audience', column: 'section_3_target_audience' },
  { step: 4, slug: 'personas', title: 'Resident Personas', column: 'section_4_personas' },
  { step: 5, slug: 'name_story', title: 'Brand Name & Story', column: 'section_5_name_story' },
  { step: 6, slug: 'logo', title: 'Logo Design', column: 'section_6_logo' },
  { step: 7, slug: 'typography', title: 'Typography System', column: 'section_7_typography' },
  { step: 8, slug: 'colors', title: 'Color Palette', column: 'section_8_colors' },
  { step: 9, slug: 'design_elements', title: 'Design Elements', column: 'section_9_design_elements' },
  { step: 10, slug: 'photo_yep', title: 'Photo Guidelines - Yep', column: 'section_10_photo_yep' },
  { step: 11, slug: 'photo_nope', title: 'Photo Guidelines - Nope', column: 'section_11_photo_nope' },
  { step: 12, slug: 'implementation', title: 'Implementation Examples', column: 'section_12_implementation' },
] as const

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function asDraftSection(value: unknown) {
  const record = asRecord(value)
  if (!record) return null

  const step = asNumber(record.step)
  const name = asString(record.name)
  if (!step || !name) return null

  return {
    step,
    name,
    status: asString(record.status),
    version: asNumber(record.version),
    generatedAt: asString(record.generated_at),
    regeneratedAt: asString(record.regenerated_at),
  }
}

function getSectionTitle(step: number | null, slug: string | null) {
  const section = BRAND_SECTIONS.find((entry) => entry.step === step || entry.slug === slug)
  return section?.title ?? null
}

function countApprovedSections(brandAsset: Record<string, unknown>) {
  return BRAND_SECTIONS.filter((section) => brandAsset[section.column] !== null).length
}

function buildWarnings(brandAsset: Record<string, unknown>) {
  const warnings: Array<{
    code: string
    severity: 'warning'
    title: string
    message: string
    action: string
  }> = []

  const logoSection = asRecord(brandAsset.section_6_logo)
  const logoPrimaryUrl = asString(logoSection?.primary_url) ?? asString(logoSection?.logoUrl)

  if (logoPrimaryUrl === '/placeholder-logo.png') {
    warnings.push({
      code: 'logo_placeholder_fallback',
      severity: 'warning',
      title: 'Logo asset used a placeholder',
      message:
        'BrandForge kept the flow moving, but the logo image fell back to a placeholder because Vertex AI image generation is not fully available.',
      action:
        'Continue approving the brand book, then regenerate visual assets from the brand-book page after image credentials or quota are restored.',
    })
  }

  if (brandAsset.generation_status === 'reviewing' && !asRecord(brandAsset.draft_section)) {
    warnings.push({
      code: 'missing_draft_review_state',
      severity: 'warning',
      title: 'Review state is missing its draft payload',
      message:
        'BrandForge is marked as reviewing, but no draft section payload is currently stored for the operator to review.',
      action: 'Regenerate the current section to restore the review step.',
    })
  }

  if (brandAsset.generation_status === 'complete' && !asString(brandAsset.brand_book_pdf_url)) {
    warnings.push({
      code: 'export_not_generated',
      severity: 'warning',
      title: 'Brand book export is not ready yet',
      message:
        'All sections are approved, but the final downloadable brand-book export has not been generated successfully yet.',
      action: 'Retry the export from the completion screen or the brand-book page.',
    })
  }

  return warnings
}

function buildStatusMessage(
  generationStatus: string | null,
  currentSectionTitle: string | null,
  isComplete: boolean,
  hasExport: boolean,
  hasDraftSection: boolean
) {
  if (generationStatus === 'conversation') {
    return 'Brand strategy conversation in progress.'
  }

  if (generationStatus === 'reviewing' && currentSectionTitle) {
    return `Reviewing ${currentSectionTitle}.`
  }

  if (generationStatus === 'generating' && currentSectionTitle) {
    return `Preparing ${currentSectionTitle}.`
  }

  if (isComplete && hasExport) {
    return 'Brand book export ready.'
  }

  if (isComplete) {
    return 'All sections approved. Final export still needs attention.'
  }

  if (hasDraftSection) {
    return 'Draft section ready for review.'
  }

  return 'Brand book in progress.'
}

function buildPhase(
  generationStatus: string | null,
  isComplete: boolean,
  hasExport: boolean,
  hasDraftSection: boolean
): 'conversation' | 'generating' | 'reviewing' | 'complete' | 'attention_required' {
  if (generationStatus === 'conversation') return 'conversation'
  if (generationStatus === 'reviewing' || hasDraftSection) return 'reviewing'
  if (generationStatus === 'generating') return 'generating'
  if (isComplete && hasExport) return 'complete'
  if (isComplete && !hasExport) return 'attention_required'
  return 'generating'
}

function getPhaseLabel(phase: string): string {
  if (phase === 'conversation') return 'Conversation'
  if (phase === 'reviewing') return 'Operator Review'
  if (phase === 'generating') return 'Generating Section'
  if (phase === 'complete') return 'Completed'
  return 'Needs Attention'
}

function getProgressPercent(
  phase: string,
  approvedSections: number,
  totalSections: number
) {
  if (phase === 'conversation') return 20
  if (phase === 'complete') return 100
  if (phase === 'attention_required') return 95
  return 20 + Math.round((approvedSections / totalSections) * 75)
}

function buildNextAction(
  generationStatus: string | null,
  isComplete: boolean,
  hasExport: boolean,
  currentSectionTitle: string | null,
  hasDraftSection: boolean
) {
  if (generationStatus === 'conversation') {
    return 'Finish the strategist conversation to unlock section generation.'
  }

  if (hasDraftSection) {
    return 'Review the current draft, then edit, regenerate, or approve it to continue.'
  }

  if (isComplete && !hasExport) {
    return 'Retry the final export, then add the completed brand book to the knowledge base.'
  }

  if (isComplete) {
    return 'Download the export or embed the brand book into the knowledge base for downstream products.'
  }

  if (currentSectionTitle) {
    return `Continue BrandForge generation with ${currentSectionTitle}.`
  }

  return 'Resume the BrandForge flow from the last completed step.'
}

/**
 * Get brand asset status and progress
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const propertyId = req.nextUrl.searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: brandAsset, error } = await supabase
      .from('property_brand_assets')
      .select('*')
      .eq('property_id', propertyId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No brand asset exists
        return NextResponse.json({ exists: false })
      }
      throw error
    }

    const brandRecord = brandAsset as unknown as Record<string, unknown>
    const approvedSections = countApprovedSections(brandRecord)
    const currentStep = asNumber(brandRecord.current_step)
    const currentStepName = asString(brandRecord.current_step_name)
    const draftSection = asDraftSection(brandRecord.draft_section)
    const currentSectionTitle = getSectionTitle(draftSection?.step ?? currentStep, draftSection?.name ?? currentStepName)
    const hasExport = Boolean(brandAsset.brand_book_pdf_url)
    const isComplete = brandAsset.generation_status === 'complete'
    const warnings = buildWarnings(brandRecord)
    const phase = buildPhase(asString(brandAsset.generation_status), isComplete, hasExport, Boolean(draftSection))
    const lastActivityAt =
      draftSection?.regeneratedAt ??
      draftSection?.generatedAt ??
      asString(brandAsset.updated_at)
    const secondsSinceLastActivity = lastActivityAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(lastActivityAt)) / 1000))
      : null

    const sectionNameStory = asRecord(brandAsset.section_5_name_story)

    return NextResponse.json({
      exists: true,
      brandAsset: {
        id: brandAsset.id,
        currentStep,
        currentStepName,
        currentSectionTitle,
        generationStatus: brandAsset.generation_status,
        phase,
        phaseLabel: getPhaseLabel(phase),
        approvedSections,
        totalSections: 12,
        progress: getProgressPercent(phase, approvedSections, 12),
        isComplete,
        pdfUrl: brandAsset.brand_book_pdf_url,
        exportUrl: brandAsset.brand_book_pdf_url,
        exportFormat: 'pdf',
        pdfGeneratedAt: brandAsset.pdf_generated_at,
        brandName: asString(sectionNameStory?.name),
        colors: brandAsset.section_8_colors,
        logo: brandAsset.section_6_logo,
        updatedAt: brandAsset.updated_at,
        draftSection,
        activeSection: currentSectionTitle
          ? {
              step: draftSection?.step ?? currentStep,
              slug: draftSection?.name ?? currentStepName,
              title: currentSectionTitle,
            }
          : null,
        lastActivityAt,
        secondsSinceLastActivity,
        isPossiblyStalled:
          phase === 'generating' &&
          secondsSinceLastActivity !== null &&
          secondsSinceLastActivity > 180,
        warnings,
        statusMessage: buildStatusMessage(
          asString(brandAsset.generation_status),
          currentSectionTitle,
          isComplete,
          hasExport,
          Boolean(draftSection)
        ),
        nextRecommendedAction: buildNextAction(
          asString(brandAsset.generation_status),
          isComplete,
          hasExport,
          currentSectionTitle,
          Boolean(draftSection)
        ),
      }
    })

  } catch (error) {
    console.error('Brand Status Error:', error)
    return NextResponse.json({ 
      error: 'Failed to get status', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}























