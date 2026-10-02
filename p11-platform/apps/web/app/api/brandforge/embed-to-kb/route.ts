import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { normalizeBrandAssetRow } from '@/utils/brandforge/normalize'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 30000 })

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

import { randomUUID } from 'node:crypto'
import { brandId, runBrandCommand } from '@/utils/brandforge/operations'
export async function POST(request: NextRequest) {
 return runBrandCommand(request, 'publish', { propertyId: brandId }, async ({ body: { brandAssetId, propertyId }, brand }) => {
  if (brand.property_id !== propertyId) throw new Error('Property mismatch')
    const contract = normalizeBrandAssetRow(
      brand as unknown as Record<string, unknown>,
    )

    // Build content chunks from brand book sections
    const chunks: Chunk[] = [{
      content: `Approved BrandForge V1 contract: ${JSON.stringify(contract)}`,
      metadata: {
        section: 'canonical_contract',
        type: 'brand_book',
        contract_version: contract.contractVersion,
        brand_origin: contract.origin,
      },
    }]

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

    // Prepare every vector before replacing any currently published knowledge.
    const response = await openai.embeddings.create({ model: 'text-embedding-3-small', input: chunks.map(chunk => chunk.content) })
    if (response.data.length !== chunks.length) throw new Error('Incomplete embedding response')
    const byIndex = new Map(response.data.map(item => [item.index, item.embedding]))
    const documents = chunks.map((chunk, index) => {
      const embedding = byIndex.get(index)
      if (!embedding || embedding.length !== 1536 || embedding.some(value => !Number.isFinite(value))) throw new Error('Invalid embedding response')
      return { id: randomUUID(), content: chunk.content, embedding, metadata: { ...chunk.metadata, brand_origin: contract.origin } }
    })
    return { updates: {}, result: { embeddedChunks: documents.length, totalChunks: documents.length, publishedRevision: brand.revision, contextRefresh: 'pending', knowledgeReceipt: { documents, sourceName: `Brand Book: ${contract.identity.name || brandAssetId}` } } }
 })
}
