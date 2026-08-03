import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  hashBrandForgeContract,
  normalizeBrandAssetRow,
} from '@/utils/brandforge/normalize'

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

    const contract = normalizeBrandAssetRow(brand as unknown as Record<string, unknown>)
    const contractHash = brand.contract_hash || hashBrandForgeContract(contract)
    const primaryLogo = contract.logos.variants.find(variant => variant.role === 'primary')
      || contract.logos.variants[0]
    const primaryFont = contract.typography.roles.find(role => role.role === 'headline')
    const secondaryFont = contract.typography.roles.find(role => role.role === 'body')
    const primaryColors = contract.colors.roles.filter(color => color.role === 'primary')
    const secondaryColors = contract.colors.roles.filter(color => color.role === 'secondary')

    const assets = {
      exists: true,
      propertyId,
      brandAssetId: brand.id,
      generationStatus: brand.generation_status,
      approvalStatus: brand.approval_status,
      origin: contract.origin,
      contractVersion: contract.contractVersion,
      contractHash,
      
      brandName: contract.identity.name,
      tagline: contract.identity.tagline,
      
      logo: {
        url: primaryLogo?.url || null,
        assetId: primaryLogo?.assetId || null,
        alt: primaryLogo?.alt || contract.identity.name,
        hasGenerated: contract.origin === 'generated' && Boolean(primaryLogo),
      },
      
      colors: {
        primary: primaryColors,
        secondary: secondaryColors,
        palette: contract.colors.roles,
      },
      
      typography: {
        primaryFont: primaryFont?.family || null,
        secondaryFont: secondaryFont?.family || null,
        primaryUsage: primaryFont?.usage || null,
        secondaryUsage: secondaryFont?.usage || null,
        roles: contract.typography.roles,
      },
      
      voice: {
        personality: contract.positioning.voice.join(', '),
        positioning: contract.positioning.statement,
        targetAudience: contract.audience.primary,
      },
      
      visuals: {
        designElements: contract.designElements.elements,
        photoExampleAssetIds: contract.photographyYes.exampleAssetIds,
        visionBoardUrl: brand.vision_board_url,
      },
      
      contract,
      
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





















