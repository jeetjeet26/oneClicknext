import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { upsertManagedKnowledgeSource } from '@/utils/services/knowledge-sources'
import type { Json } from '@/types/supabase'
import OpenAI from 'openai'

const supabase = createServiceClient()

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

type Chunk = {
  content: string
  metadata: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringList(value: unknown): string[] {
  return asArray(value).map(item => asString(item)).filter(Boolean)
}

function asColorList(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.map(item => asRecord(item)).filter((item): item is Record<string, unknown> => item !== null)
  }
  const maybeRecord = asRecord(value)
  return maybeRecord ? [maybeRecord] : []
}

function formatColorList(value: unknown): string {
  const colors = asColorList(value)
  return colors
    .map(color => {
      const name = asString(color.name)
      const hex = asString(color.hex)
      if (name && hex) return `${name} (${hex})`
      return name || hex
    })
    .filter(Boolean)
    .join(', ')
}

function getTypographyFontNames(section: Record<string, unknown>): string[] {
  const headline = asRecord(section.headline)
  const body = asRecord(section.body)
  const primaryFont = asRecord(section.primaryFont)
  const secondaryFont = asRecord(section.secondaryFont)
  const accent = asRecord(section.accent)

  return [
    asString(headline?.font),
    asString(body?.font),
    asString(primaryFont?.name),
    asString(secondaryFont?.name),
    asString(accent?.font),
  ].filter(Boolean)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Embed brand book content into knowledge base for RAG
 * This makes brand assets searchable by other products (SiteForge, LumaLeasing, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { brandAssetId, propertyId } = await request.json()

    if (!brandAssetId || !propertyId) {
      return NextResponse.json(
        { error: 'brandAssetId and propertyId required' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch the brand asset
    const { data: brand, error: fetchError } = await supabase
      .from('property_brand_assets')
      .select('*')
      .eq('id', brandAssetId)
      .single()

    if (fetchError || !brand) {
      return NextResponse.json({ error: 'Brand asset not found' }, { status: 404 })
    }

    if (brand.property_id !== propertyId) {
      return NextResponse.json({ error: 'Property mismatch for brand asset' }, { status: 400 })
    }

    // Build content chunks from brand book sections
    const chunks: Chunk[] = []

    // Section 1: Introduction
    const intro = asRecord(brand.section_1_introduction)
    if (intro) {
      chunks.push({
        content: `Brand Introduction: ${asString(intro.title) || 'Brand'}. Tagline: "${asString(intro.tagline)}". ${asString(intro.story)} Brand Essence: ${asString(intro.brandEssence)}`,
        metadata: { section: 'introduction', type: 'brand_book' }
      })
    }

    // Section 2: Positioning
    const positioning = asRecord(brand.section_2_positioning)
    if (positioning) {
      const differentiators = asArray(positioning.differentiators)
        .map(item => asString(item))
        .filter(item => item.length > 0)
        .join(', ')
      chunks.push({
        content: `Brand Positioning: ${asString(positioning.statement)}. Differentiators: ${differentiators}. Competitive Advantage: ${asString(positioning.competitiveAdvantage)}`,
        metadata: { section: 'positioning', type: 'brand_book' }
      })
    }

    // Section 3: Target Audience
    const audience = asRecord(brand.section_3_target_audience)
    if (audience) {
      const demographics = asRecord(audience.demographics)
      chunks.push({
        content: `Target Audience: ${asString(audience.primary)}. Demographics: Age ${asString(demographics?.age) || 'N/A'}, Income ${asString(demographics?.income) || 'N/A'}. Psychographics: ${asArray(audience.psychographics).map(item => asString(item)).filter(Boolean).join(', ')}`,
        metadata: { section: 'target_audience', type: 'brand_book' }
      })
    }

    // Section 4: Personas
    const personasSection = asRecord(brand.section_4_personas)
    if (personasSection) {
      const personas = asArray(personasSection.personas)
        .map((entry) => {
          const persona = asRecord(entry)
          return `${asString(persona?.name)}: ${asString(persona?.description)} (Needs: ${asString(persona?.needs)})`
        })
        .filter(item => item.trim().length > 0)
        .join(' | ')
      if (personas) {
        chunks.push({
          content: `Brand Personas: ${personas}`,
          metadata: { section: 'personas', type: 'brand_book' }
        })
      }
    }

    // Section 5: Name & Story
    const nameStory = asRecord(brand.section_5_name_story)
    if (nameStory) {
      chunks.push({
        content: `Brand Name: "${asString(nameStory.name)}". Meaning: ${asString(nameStory.meaning)}. Origin Story: ${asString(nameStory.story)}`,
        metadata: { section: 'name_story', type: 'brand_book' }
      })
    }

    // Section 6: Logo
    const logo = asRecord(brand.section_6_logo)
    if (logo) {
      const logoUrl = asString(logo.primary_url) || asString(logo.logoUrl)
      chunks.push({
        content: `Logo Design: Rationale - ${asString(logo.design_rationale) || asString(logo.concept)}. Style: ${asString(logo.style)}. Variations: ${JSON.stringify(logo.variations || {})}. Logo URL: ${logoUrl || 'Not generated'}`,
        metadata: { 
          section: 'logo', 
          type: 'brand_book',
          logo_url: logoUrl || null,
          has_generated_logo: !!logoUrl
        }
      })
    }

    // Section 7: Typography
    const typography = asRecord(brand.section_7_typography)
    if (typography) {
      const fontNames = getTypographyFontNames(typography)
      chunks.push({
        content: `Typography: Headline - ${JSON.stringify(typography.headline || {})}. Body - ${JSON.stringify(typography.body || {})}. Accent - ${JSON.stringify(typography.accent || {})}.`,
        metadata: { 
          section: 'typography', 
          type: 'brand_book',
          typography_fonts: fontNames
        }
      })
    }

    // Section 8: Colors
    const colors = asRecord(brand.section_8_colors)
    if (colors) {
      const primaryColors = formatColorList(colors.primary)
      const secondaryColors = formatColorList(colors.secondary)
      const accentColors = formatColorList(colors.accents)
      chunks.push({
        content: `Color Palette: ${asString(colors.palette)}. Primary Colors: ${primaryColors}. Secondary Colors: ${secondaryColors}. Accent Colors: ${accentColors}. Usage: ${asString(colors.usageGuidelines)}`,
        metadata: { 
          section: 'colors', 
          type: 'brand_book',
          primary_colors: asColorList(colors.primary).map(color => asString(color.hex)).filter(Boolean),
          secondary_colors: asColorList(colors.secondary).map(color => asString(color.hex)).filter(Boolean),
          accent_colors: asColorList(colors.accents).map(color => asString(color.hex)).filter(Boolean),
        }
      })
    }

    // Section 9: Design Elements
    const design = asRecord(brand.section_9_design_elements)
    if (design) {
      chunks.push({
        content: `Design Elements: ${JSON.stringify(asArray(design.elements))}. Usage Notes: ${asString(design.usageNotes)}`,
        metadata: { 
          section: 'design_elements', 
          type: 'brand_book',
          moodboard_urls: asArray(design.moodboardUrls)
        }
      })
    }

    // Section 10: Photo Yep
    const photoYep = asRecord(brand.section_10_photo_yep)
    if (photoYep) {
      chunks.push({
        content: `Photo Guidelines (Approved): ${asString(photoYep.description)}. Criteria: ${asStringList(photoYep.criteria).join(', ')}`,
        metadata: { 
          section: 'photo_yep', 
          type: 'brand_book',
          photo_urls: asArray(photoYep.generatedPhotos)
        }
      })
    }

    // Section 11: Photo Nope
    const photoNope = asRecord(brand.section_11_photo_nope)
    if (photoNope) {
      chunks.push({
        content: `Photo Guidelines (Avoid): ${asString(photoNope.description)}. Criteria: ${asStringList(photoNope.criteria).join(', ')}`,
        metadata: { section: 'photo_nope', type: 'brand_book' }
      })
    }

    // Section 12: Implementation
    const implementation = asRecord(brand.section_12_implementation)
    if (implementation) {
      chunks.push({
        content: `Brand Implementation: ${JSON.stringify(asArray(implementation.examples))}`,
        metadata: { section: 'implementation', type: 'brand_book' }
      })
    }

    // Conversation Summary (master reference)
    const summary = asRecord(brand.conversation_summary)
    if (summary) {
      chunks.push({
        content: `Brand Strategy Summary: Brand Name - ${asString(summary.brandName)}. Tagline - "${asString(summary.tagline)}". Target Audience - ${asString(summary.targetAudience)}. Brand Personality - ${asArray(summary.brandPersonality).map(item => asString(item)).filter(Boolean).join(', ')}. Color Direction - ${asString(summary.colorDirection)}. Positioning - ${asString(summary.positioning)}`,
        metadata: { 
          section: 'summary', 
          type: 'brand_book',
          brand_name: asString(summary.brandName) || null,
          tagline: asString(summary.tagline) || null
        }
      })
    }

    // Delete any existing brand book embeddings for this property
    await supabase
      .from('documents')
      .delete()
      .eq('property_id', propertyId)
      .eq('metadata->>type', 'brand_book')

    // Generate embeddings and insert
    let embeddedCount = 0
    for (const chunk of chunks) {
      try {
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: chunk.content
        })

        const embedding = embeddingResponse.data[0].embedding

        const { error: insertError } = await supabase
          .from('documents')
          .insert({
            property_id: propertyId,
            content: chunk.content,
            metadata: {
              ...chunk.metadata,
              brand_origin: 'generated_brandforge',
              brand_asset_id: brandAssetId,
              embedded_at: new Date().toISOString()
            },
            embedding
          } as never)

        if (insertError) {
          console.error('Error inserting embedding:', insertError)
        } else {
          embeddedCount++
        }
      } catch (err) {
        console.error('Error generating embedding for chunk:', getErrorMessage(err))
      }
    }

    const summaryBrandName = asString(summary?.brandName)
    const sourceName = summaryBrandName
      ? `Brand Book: ${summaryBrandName}`
      : `Brand Book: ${brandAssetId}`

    await upsertManagedKnowledgeSource(supabase, {
      propertyId,
      sourceType: 'brand_book',
      sourceName,
      status: 'completed',
      documentsCreated: embeddedCount,
      extractedData: {
        brand_origin: 'generated_brandforge',
        embedding_type: 'brand_book',
        brand_asset_id: brandAssetId,
        total_chunks: chunks.length,
        embedded_chunks: embeddedCount,
      } as Json,
    })

    // Update brand asset to mark as embedded
    await supabase
      .from('property_brand_assets')
      .update({
        updated_at: new Date().toISOString()
      })
      .eq('id', brandAssetId)

    return NextResponse.json({
      success: true,
      embeddedChunks: embeddedCount,
      totalChunks: chunks.length,
      message: `Brand book embedded into knowledge base (${embeddedCount}/${chunks.length} chunks)`
    })

  } catch (error) {
    console.error('Brand book embedding error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Embedding failed' },
      { status: 500 }
    )
  }
}





















