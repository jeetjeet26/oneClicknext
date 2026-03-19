// SiteForge: LLM Orchestration Layer
// Handles all Gemini 3 Pro interactions for site generation
// Created: December 11, 2025

import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import type {
  SiteContext,
  SiteArchitecture,
  GeneratedPage,
  ACFBlockType,
  SiteBlueprint
} from '@/types/siteforge'
import type { BlueprintPatchOperation } from '@/utils/siteforge/blueprint'
import { applyBlueprintPatch, makeBlueprintFromPages } from '@/utils/siteforge/blueprint'

function getGeminiClient(): GoogleGenerativeAI | null {
  const key = process.env.GOOGLE_GEMINI_API_KEY
  if (!key) return null
  return new GoogleGenerativeAI(key)
}

function getOpenAIClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not set (required for embeddings/KB + OpenAI fallback)')
  return new OpenAI({ apiKey: key })
}

const OPENAI_SITEFORGE_MODEL = process.env.SITEFORGE_OPENAI_MODEL || 'gpt-4.1-2025-04-14'

/**
 * Extract JSON from AI response that may be wrapped in markdown code blocks
 * Handles responses like: ```json\n{...}\n``` or ```\n{...}\n```
 */
function extractJsonFromResponse(responseText: string): string {
  // Remove markdown code block wrapper if present
  let cleaned = responseText.trim()
  
  // Handle ```json ... ``` or ``` ... ```
  const codeBlockMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim()
  }
  
  // Also handle case where there might be multiple code blocks or text before/after
  // Look for the first { to the last }
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1)
  }
  
  return cleaned
}

// ACF Blocks available in Collection theme
const ACF_BLOCKS = [
  { name: 'acf/menu', purpose: 'Section navigation menu', bestFor: ['all'] },
  { name: 'acf/top-slides', purpose: 'Hero carousel with CTA', bestFor: ['home', 'floor-plans'] },
  { name: 'acf/text-section', purpose: 'Text content', bestFor: ['about', 'policies'] },
  { name: 'acf/feature-section', purpose: 'Two-column feature highlight', bestFor: ['home', 'amenities'] },
  { name: 'acf/image', purpose: 'Single large image', bestFor: ['visual breaks'] },
  { name: 'acf/links', purpose: 'CTA buttons', bestFor: ['all'] },
  { name: 'acf/content-grid', purpose: 'Grid of items with icons/images', bestFor: ['amenities', 'features'] },
  { name: 'acf/form', purpose: 'Contact/interest form', bestFor: ['contact', 'schedule-tour'] },
  { name: 'acf/map', purpose: 'Google Maps with directions', bestFor: ['location', 'contact'] },
  { name: 'acf/html-section', purpose: 'Custom HTML', bestFor: ['special features'] },
  { name: 'acf/gallery', purpose: 'Photo gallery', bestFor: ['gallery', 'amenities'] },
  { name: 'acf/accordion-section', purpose: 'FAQ or expandable content', bestFor: ['faq', 'policies'] },
  { name: 'acf/plans-availability', purpose: 'Interactive floorplans', bestFor: ['floor-plans'] },
  { name: 'acf/poi', purpose: 'Points of interest map', bestFor: ['neighborhood'] }
]

function getAllowedAcfBlocksPrompt(): string {
  return ACF_BLOCKS.map(b => `- ${b.name}: ${b.purpose} (best for: ${b.bestFor.join(', ')})`).join('\n')
}

/**
 * Plan complete site architecture using Gemini 3 Pro
 */
export async function planSiteArchitecture(context: SiteContext): Promise<SiteArchitecture> {
  const gemini = getGeminiClient()
  if (!gemini) {
    return planSiteArchitectureOpenAI(context)
  }

  const model = gemini.getGenerativeModel({
    model: 'gemini-3-pro-preview',
    generationConfig: {
      temperature: 1.0, // Gemini 3 default - don't change
      responseMimeType: 'application/json'
    }
  })
  
  const prompt = `You are an expert WordPress site architect for multifamily real estate.

CONTEXT:
Property: ${context.property.name}
Location: ${context.property.address.city}, ${context.property.address.state}
Brand Voice: ${context.brand.data.brandVoice || 'professional'}
Target Audience: ${context.brand.data.targetAudience || 'young professionals'}
Key Amenities: ${context.property.amenities.slice(0, 10).join(', ')}
${context.competitors.commonPatterns.length > 0 ? `Competitors emphasize: ${context.competitors.commonPatterns.join(', ')}` : ''}

USER REQUEST (conversation prompt):
${context.userPrompt || '(none)'}

KB CONTEXT (facts to ground the build):
${context.kbContext ? context.kbContext : '(none)'}

USER PREFERENCES:
${context.preferences?.style ? `Style: ${context.preferences.style}` : ''}
${context.preferences?.emphasis ? `Emphasis: ${context.preferences.emphasis}` : ''}
${context.preferences?.ctaPriority ? `CTA Priority: ${context.preferences.ctaPriority}` : ''}

AVAILABLE ACF BLOCKS:
${getAllowedAcfBlocksPrompt()}

TASK: Plan the complete site structure and page layouts.

REQUIREMENTS:
1. Create 5-8 pages maximum (most users visit 2-3 pages)
2. Every page needs a clear next action/CTA
3. Mobile-first design (60% of traffic)
4. Use only the ACF blocks listed above
5. Match the brand personality in structure
6. Differentiate from competitors where possible

OUTPUT FORMAT (JSON):
{
  "navigation": {
    "structure": "primary" | "mega" | "hamburger",
    "items": [
      { "label": "Home", "slug": "home", "priority": "high" }
    ],
    "cta": { "text": "Schedule Tour", "style": "primary" }
  },
  "pages": [
    {
      "slug": "home",
      "title": "Home",
      "purpose": "Convert prospects to tour bookings",
      "sections": [
        {
          "type": "hero",
          "acfBlock": "acf/top-slides",
          "reasoning": "Strong visual first impression with immediate CTA",
          "order": 1
        }
      ]
    }
  ],
  "designDecisions": {
    "colorStrategy": "Use primary color for CTAs, secondary for accents",
    "imageStrategy": "Lifestyle photography emphasizing community",
    "contentDensity": "balanced",
    "conversionOptimization": ["Above-fold CTA", "Social proof", "Easy contact"]
  }
}

IMPORTANT: Be direct and concise. Plan a site that converts prospects to tours.`

  // NOTE: Gemini "thinking" config support may lag in @google/generative-ai TypeScript types.
  // We pass it through with a cast to keep builds stable.
  const requestWithThinking = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      thinkingConfig: { thinkingLevel: 'high' } // Deep reasoning for architecture
    }
  }
  let resultText = ''
  try {
    const result = await model.generateContent(
      requestWithThinking as unknown as Parameters<typeof model.generateContent>[0]
    )
    resultText = result.response.text()
  } catch (e) {
    // If Gemini key is invalid or request fails, fall back to OpenAI
    return planSiteArchitectureOpenAI(context)
  }
  
  const cleanedJson = extractJsonFromResponse(resultText)
  
  try {
    return JSON.parse(cleanedJson)
  } catch (parseError) {
    console.error('Failed to parse architecture JSON:', parseError)
    console.error('Raw response:', resultText.substring(0, 500))
    // Fall back to OpenAI once if parsing fails
    return planSiteArchitectureOpenAI(context)
  }
}

async function planSiteArchitectureOpenAI(context: SiteContext): Promise<SiteArchitecture> {
  const openai = getOpenAIClient()

  const prompt = `You are an expert WordPress site architect for multifamily real estate.

Build a complete site architecture using ONLY this ACF block library:
${getAllowedAcfBlocksPrompt()}

PROPERTY CONTEXT:
Property: ${context.property.name}
Location: ${context.property.address.city}, ${context.property.address.state}
Amenities: ${context.property.amenities.slice(0, 15).join(', ')}
Brand voice: ${context.brand.data.brandVoice || 'professional'}
Target audience: ${context.brand.data.targetAudience || 'young professionals'}

USER REQUEST (conversation prompt):
${context.userPrompt || '(none)'}

KB CONTEXT (facts to ground the build):
${context.kbContext ? context.kbContext : '(none)'}

OUTPUT: Return JSON only with this structure:
{
  "navigation": { "structure": "primary", "items": [{ "label": "Home", "slug": "home", "priority": "high" }], "cta": { "text": "Schedule Tour", "style": "primary" } },
  "pages": [
    { "slug": "home", "title": "Home", "purpose": "...", "sections": [ { "type": "hero", "acfBlock": "acf/top-slides", "reasoning": "...", "order": 1 } ] }
  ],
  "designDecisions": { "colorStrategy": "...", "imageStrategy": "...", "contentDensity": "balanced", "conversionOptimization": ["..."] }
}`

  const completion = await openai.chat.completions.create({
    model: OPENAI_SITEFORGE_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.7
  })

  const text = completion.choices[0]?.message?.content || '{}'
  return JSON.parse(extractJsonFromResponse(text)) as SiteArchitecture
}

/**
 * Generate content for ALL pages in a single API call
 * This approach:
 * - Uses only 1 API request (avoids rate limits)
 * - AI sees the whole site context for consistent messaging
 * - Sections can reference each other cohesively
 */
export async function generateAllPageContent(
  architecture: SiteArchitecture,
  context: SiteContext
): Promise<GeneratedPage[]> {
  const gemini = getGeminiClient()
  if (!gemini) {
    return generateAllPageContentOpenAI(architecture, context)
  }

  const model = gemini.getGenerativeModel({
    model: 'gemini-3-pro-preview',
    generationConfig: {
      temperature: 1.0,
      responseMimeType: 'application/json'
    }
  })
  
  // Build a comprehensive prompt for ALL content
  const prompt = buildFullSiteContentPrompt(architecture, context)
  
  console.log('Generating all page content in single API call...')
  
  const requestWithThinking = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      thinkingConfig: { thinkingLevel: 'medium' } // Balance quality and speed
    }
  }

  let responseText = ''
  try {
    const result = await model.generateContent(
      requestWithThinking as unknown as Parameters<typeof model.generateContent>[0]
    )
    responseText = result.response.text()
  } catch (e) {
    return generateAllPageContentOpenAI(architecture, context)
  }
  
  const cleanedJson = extractJsonFromResponse(responseText)
  
  try {
    type FullSiteContent = {
      pages?: Array<{
        slug: string
        sections?: Array<{ content?: Record<string, unknown> }>
      }>
    }
    const generatedContent = JSON.parse(cleanedJson) as FullSiteContent
    
    // Merge generated content back into architecture pages
    return architecture.pages.map(page => {
      const pageContent = generatedContent.pages?.find(p => p.slug === page.slug)
      
      if (!pageContent) {
        console.warn(`No content generated for page: ${page.slug}`)
        return page
      }
      
      return {
        ...page,
        sections: page.sections.map((section, idx) => {
          const sectionContent = pageContent.sections?.[idx]?.content
          return {
            ...section,
            content: sectionContent || {}
          }
        })
      }
    })
  } catch (parseError) {
    console.error('Failed to parse full site content JSON:', parseError)
    console.error('Raw response (first 1000 chars):', responseText.substring(0, 1000))
    return generateAllPageContentOpenAI(architecture, context)
  }
}

async function generateAllPageContentOpenAI(
  architecture: SiteArchitecture,
  context: SiteContext
): Promise<GeneratedPage[]> {
  const openai = getOpenAIClient()
  const prompt = buildFullSiteContentPrompt(architecture, context)
  const completion = await openai.chat.completions.create({
    model: OPENAI_SITEFORGE_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.7
  })
  const responseText = completion.choices[0]?.message?.content || '{}'
  const cleanedJson = extractJsonFromResponse(responseText)

  type FullSiteContent = {
    pages?: Array<{
      slug: string
      sections?: Array<{ content?: Record<string, unknown> }>
    }>
  }
  const generatedContent = JSON.parse(cleanedJson) as FullSiteContent

  return architecture.pages.map(page => {
    const pageContent = generatedContent.pages?.find(p => p.slug === page.slug)
    if (!pageContent) return page
    return {
      ...page,
      sections: page.sections.map((section, idx) => ({
        ...section,
        content: pageContent.sections?.[idx]?.content || {}
      }))
    }
  })
}

/**
 * Create a canonical editable Blueprint from generated pages.
 * Today, Blueprint == pages + stable section IDs.
 */
export function createSiteBlueprintFromPages(pages: GeneratedPage[], version = 1): SiteBlueprint {
  return makeBlueprintFromPages(pages, version)
}

/**
 * Edit a site Blueprint based on a user's natural language instruction.
 * The LLM must return PATCH OPERATIONS only (no prose), which we validate by shape
 * and apply deterministically.
 */
export async function editSiteBlueprintWithLLM(args: {
  blueprint: SiteBlueprint
  context: SiteContext
  instruction: string
  selected?: { sectionId?: string; pageSlug?: string }
}): Promise<{ blueprint: SiteBlueprint; operations: BlueprintPatchOperation[]; summary?: string }> {
  const { blueprint, context, instruction, selected } = args

  // Prefer Gemini if configured, otherwise fall back to OpenAI.
  const gemini = getGeminiClient()

  const selectedSection = selected?.sectionId
    ? blueprint.pages.flatMap(p => p.sections || []).find(s => s.id === selected.sectionId)
    : null

  const prompt = `You are SiteForge, an expert WordPress website editor for multifamily real estate.

You MUST edit the website by emitting JSON patch operations over an allowlisted ACF block library.
Do not generate arbitrary code. Do not reference tools. Do not output markdown.

PROPERTY CONTEXT:
Property: ${context.property.name}
Location: ${context.property.address.city}, ${context.property.address.state}
Amenities: ${context.property.amenities.slice(0, 15).join(', ')}

BRAND VOICE:
${context.brand.data.brandVoice || 'professional and welcoming'}

ALLOWED ACF BLOCKS:
${getAllowedAcfBlocksPrompt()}

CURRENT SITE (Blueprint):
${JSON.stringify(blueprint, null, 2)}

SELECTED SECTION (if any):
${selectedSection ? JSON.stringify(selectedSection, null, 2) : 'null'}

USER INSTRUCTION:
${instruction}

TASK:
Return JSON with this exact structure:
{
  "summary": "Short description of the change",
  "operations": [
    {
      "op": "update_section",
      "sectionId": "existing-section-id",
      "content": { /* full updated content object for that section */ },
      "reasoning": "brief"
    }
  ]
}

Rules:
1) Prefer updating the selected section if provided.
2) You may add a new section ONLY if the instruction explicitly asks to add a new section/feature.
   Use op = \"add_section\" with: { pageSlug, afterSectionId?, section:{ type, acfBlock, content, reasoning } }.
3) Do NOT remove or move sections unless explicitly requested.
4) Content must be realistic and based on the property context; do not invent facts.
5) Keep the number of operations small (1-3).`

  let cleanedJson = ''
  if (gemini) {
    try {
      const model = gemini.getGenerativeModel({
        model: 'gemini-3-pro-preview',
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      })
      const requestWithThinking = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          thinkingConfig: { thinkingLevel: 'medium' },
        },
      }
      const result = await model.generateContent(
        requestWithThinking as unknown as Parameters<typeof model.generateContent>[0]
      )
      cleanedJson = extractJsonFromResponse(result.response.text())
    } catch {
      // fall back to OpenAI below
    }
  }

  if (!cleanedJson) {
    const openai = getOpenAIClient()
    const completion = await openai.chat.completions.create({
      model: OPENAI_SITEFORGE_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7
    })
    cleanedJson = extractJsonFromResponse(completion.choices[0]?.message?.content || '{}')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(cleanedJson)
  } catch (e) {
    console.error('Failed to parse blueprint edit JSON:', e)
    throw new Error('AI returned invalid JSON for blueprint edit. Please try again.')
  }

  const operations = extractOperations(parsed)
  if (operations.length === 0) {
    throw new Error('AI returned no operations. Please try again.')
  }

  // Minimal allowlist enforcement (block names only) for add_section ops
  for (const op of operations) {
    if (op.op === 'add_section') {
      const isAllowed = ACF_BLOCKS.some(b => b.name === op.section.acfBlock)
      if (!isAllowed) throw new Error(`AI attempted to add unsupported block: ${op.section.acfBlock}`)
    }
  }

  const nextBlueprint = applyBlueprintPatch(blueprint, operations)
  const summary = typeof getStringField(parsed, 'summary') === 'string' ? getStringField(parsed, 'summary') : undefined
  return { blueprint: nextBlueprint, operations, summary }
}

function extractOperations(parsed: unknown): BlueprintPatchOperation[] {
  if (!parsed || typeof parsed !== 'object') return []
  if (!('operations' in parsed)) return []
  const opsUnknown = (parsed as { operations?: unknown }).operations
  if (!Array.isArray(opsUnknown)) return []

  const ops: BlueprintPatchOperation[] = []
  for (const item of opsUnknown) {
    if (!item || typeof item !== 'object') continue
    const opValue = (item as { op?: unknown }).op
    if (typeof opValue !== 'string') continue
    // Minimal shape enforcement; deeper validation happens when applying (and by allowlists).
    ops.push(item as BlueprintPatchOperation)
  }
  return ops
}

function getStringField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const value = (obj as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Build comprehensive prompt for generating ALL site content at once
 */
function buildFullSiteContentPrompt(
  architecture: SiteArchitecture,
  context: SiteContext
): string {
  // Build the page structure for the prompt
  const pagesStructure = architecture.pages.map(page => ({
    slug: page.slug,
    title: page.title,
    purpose: page.purpose,
    sections: page.sections.map(section => ({
      type: section.type,
      acfBlock: section.acfBlock,
      reasoning: section.reasoning,
      order: section.order,
      schema: getACFBlockSchema(section.acfBlock)
    }))
  }))
  
  return `You are an expert copywriter for multifamily real estate websites.
Generate compelling, conversion-focused content for an ENTIRE website in one response.

=== PROPERTY CONTEXT ===
Property Name: ${context.property.name}
Location: ${context.property.address.city}, ${context.property.address.state}
${context.property.unitCount ? `Units: ${context.property.unitCount}` : ''}
${context.property.yearBuilt ? `Year Built: ${context.property.yearBuilt}` : ''}

=== BRAND GUIDELINES ===
Brand Voice: ${context.brand.data.brandVoice || 'professional and welcoming'}
Target Audience: ${context.brand.data.targetAudience || 'young professionals'}
Brand Personality: ${context.brand.data.brandPersonality?.join(', ') || 'modern, approachable, trustworthy'}
${context.brand.data.tagline ? `Tagline: ${context.brand.data.tagline}` : ''}
${context.brand.data.positioning ? `Positioning: ${context.brand.data.positioning}` : ''}

=== AMENITIES ===
${context.property.amenities.slice(0, 15).map((a, i) => `${i + 1}. ${a}`).join('\n')}

=== AVAILABLE PHOTOS ===
${context.property.photos.slice(0, 10).map((p, i) => `${i}. ${p.alt || p.category || 'Property photo'}`).join('\n')}

=== DESIGN STRATEGY ===
${architecture.designDecisions?.colorStrategy || 'Use primary brand colors for CTAs'}
${architecture.designDecisions?.imageStrategy || 'Lifestyle photography emphasizing community'}
Conversion Goals: ${architecture.designDecisions?.conversionOptimization?.join(', ') || 'Tour bookings, contact form submissions'}

=== USER REQUEST (CONVERSATION PROMPT) ===
${context.userPrompt || '(none)'}

=== KNOWLEDGE BASE CONTEXT (GROUND TRUTH) ===
${context.kbContext || '(none)'}

=== SITE STRUCTURE ===
${JSON.stringify(pagesStructure, null, 2)}

=== YOUR TASK ===
Generate content for EVERY section on EVERY page. Ensure:
1. Consistent brand voice across all pages
2. CTAs that guide users toward conversion (tours, applications, contact)
3. Each page has a clear purpose and next action
4. Content references property-specific details (amenities, location, etc.)
5. Headlines are compelling and benefit-focused (not generic)
6. Copy is scannable with short paragraphs
7. Cross-page coherence (don't repeat the same phrases, but maintain theme)

=== OUTPUT FORMAT ===
Return JSON with this exact structure:
{
  "pages": [
    {
      "slug": "home",
      "sections": [
        {
          "order": 1,
          "content": { /* content matching the ACF block schema */ }
        }
      ]
    }
  ]
}

Each section's "content" must match the schema provided in the site structure above.
Generate real, specific content - not placeholder text.
Make it compelling enough to convert a prospect into a tour booking.`
}

/**
 * Get ACF block schema for content generation
 */
function getACFBlockSchema(blockType: ACFBlockType): string {
  const schemas: Record<ACFBlockType, string> = {
    'acf/top-slides': `{
  "slides": [
    {
      "image_index": 0,
      "headline": "Compelling headline (5-8 words)",
      "subheadline": "Supporting text (10-15 words)",
      "cta_text": "Schedule Tour",
      "cta_link": "/contact"
    }
  ]
}`,
    'acf/text-section': `{
  "headline": "Section headline",
  "content": "<p>Paragraph text with HTML tags</p>",
  "layout": "center" | "left" | "right",
  "background": "white" | "light" | "dark"
}`,
    'acf/content-grid': `{
  "columns": 3,
  "items": [
    {
      "headline": "Feature name",
      "description": "Benefit-focused description (20-30 words)",
      "icon": "fa-swimming-pool",
      "image_index": null
    }
  ]
}`,
    'acf/feature-section': `{
  "image_index": 0,
  "headline": "Feature headline",
  "content": "<p>Feature description</p>",
  "layout": "image-left" | "image-right",
  "cta_text": "Learn More",
  "cta_link": "/amenities"
}`,
    'acf/gallery': `{
  "layout": "grid" | "carousel",
  "image_indices": [0, 1, 2, 3, 4, 5]
}`,
    'acf/form': `{
  "heading": "Schedule Your Tour",
  "subheading": "We'll get back to you within 24 hours",
  "form_type": "contact",
  "redirect_url": "/thank-you"
}`,
    'acf/map': `{
  "show_directions": true,
  "zoom_level": 15
}`,
    'acf/links': `{
  "links": [
    {
      "text": "CTA text",
      "url": "/page",
      "style": "primary" | "secondary"
    }
  ]
}`,
    'acf/accordion-section': `{
  "items": [
    {
      "title": "Question or section title",
      "content": "<p>Answer or content</p>"
    }
  ]
}`,
    'acf/image': `{
  "image_index": 0,
  "caption": "Image caption",
  "size": "full" | "large" | "medium"
}`,
    'acf/html-section': `{
  "html_content": "<div>Custom HTML content</div>"
}`,
    'acf/menu': `{
  "menu_items": ["Home", "Amenities", "Floor Plans", "Gallery", "Contact"]
}`,
    'acf/plans-availability': `{
  "data_source": "yardi"
}`,
    'acf/poi': `{
  "categories": ["restaurants", "shopping", "entertainment", "transit"],
  "radius_miles": 2,
  "intro_text": "Explore everything nearby"
}`
  }
  
  return schemas[blockType] || '{}'
}

/**
 * Refine site based on user feedback
 */
export async function refineSite(
  architecture: SiteArchitecture,
  context: SiteContext,
  refinements: {
    tone?: string
    emphasis?: string
    cta?: string
  }
): Promise<SiteArchitecture> {
  void architecture
  void context
  void refinements
  throw new Error(
    'Site refinement is not implemented yet. Use the SiteForge blueprint edit flow instead of the unfinished refinement path.'
  )
}
