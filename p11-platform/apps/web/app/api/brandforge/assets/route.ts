import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * Get brand assets for a property
 * Used by SiteForge, LumaLeasing, and other products
 * 
 * Returns structured brand data including:
 * - Logo URL
 * - Color palette (hex codes)
 * - Typography (font names)
 * - Brand voice/personality
 * - Moodboard URLs
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch brand assets
    const { data: brand, error } = await supabase
      .from('property_brand_assets')
      .select('*')
      .eq('property_id', propertyId)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching brand assets:', error)
      return NextResponse.json({ error: 'Failed to fetch brand assets' }, { status: 500 })
    }

    if (!brand) {
      return NextResponse.json({
        exists: false,
        message: 'No brand assets found for this property'
      })
    }

    const conversationSummary = asRecord(brand.conversation_summary)
    const section1 = asRecord(brand.section_1_introduction)
    const section2 = asRecord(brand.section_2_positioning)
    const section3 = asRecord(brand.section_3_target_audience)
    const section5 = asRecord(brand.section_5_name_story)
    const section6 = asRecord(brand.section_6_logo)
    const section7 = asRecord(brand.section_7_typography)
    const section8 = asRecord(brand.section_8_colors)
    const section9 = asRecord(brand.section_9_design_elements)
    const section10 = asRecord(brand.section_10_photo_yep)
    const primaryFont = asRecord(section7?.primaryFont)
    const secondaryFont = asRecord(section7?.secondaryFont)

    const mapColorList = (value: unknown) =>
      asArray(value).map(entry => {
        const color = asRecord(entry)
        return {
          name: asString(color?.name),
          hex: asString(color?.hex),
          usage: asString(color?.usage),
        }
      })

    // Extract the most commonly needed assets for other products
    const assets = {
      exists: true,
      propertyId,
      brandAssetId: brand.id,
      generationStatus: brand.generation_status,
      
      // Core brand identity
      brandName: asString(conversationSummary?.brandName) || asString(section5?.name),
      tagline: asString(conversationSummary?.tagline) || asString(section1?.tagline),
      
      // Logo
      logo: {
        url: asString(section6?.logoUrl),
        concept: asString(section6?.concept),
        style: asString(section6?.style),
        hasGenerated: !!asString(section6?.logoUrl)
      },
      
      // Colors - ready for CSS/design use
      colors: {
        primary: mapColorList(section8?.primary),
        secondary: mapColorList(section8?.secondary),
        palette: section8?.palette ?? null
      },
      
      // Typography - ready for CSS/design use
      typography: {
        primaryFont: asString(primaryFont?.name),
        secondaryFont: asString(secondaryFont?.name),
        primaryUsage: asString(primaryFont?.usage),
        secondaryUsage: asString(secondaryFont?.usage)
      },
      
      // Brand voice for content generation
      voice: {
        personality: asString(conversationSummary?.brandPersonality),
        positioning: asString(section2?.statement),
        targetAudience: asString(section3?.primary)
      },
      
      // Visual assets
      visuals: {
        moodboardUrls: asArray(section9?.moodboardUrls),
        photoExamples: asArray(section10?.generatedPhotos),
        visionBoardUrl: brand.vision_board_url
      },
      
      // Full sections (if needed)
      sections: {
        introduction: brand.section_1_introduction,
        positioning: brand.section_2_positioning,
        targetAudience: brand.section_3_target_audience,
        personas: brand.section_4_personas,
        nameStory: brand.section_5_name_story,
        logo: brand.section_6_logo,
        typography: brand.section_7_typography,
        colors: brand.section_8_colors,
        designElements: brand.section_9_design_elements,
        photoYep: brand.section_10_photo_yep,
        photoNope: brand.section_11_photo_nope,
        implementation: brand.section_12_implementation
      },
      
      // Metadata
      createdAt: brand.created_at,
      updatedAt: brand.updated_at
    }

    return NextResponse.json(assets)

  } catch (error) {
    console.error('Brand assets error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get brand assets' },
      { status: 500 }
    )
  }
}





















