import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GoogleAuth } from 'google-auth-library'
import path from 'path'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '')

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

type BrandContext = {
  brandName?: string
  vision?: string
  targetAudience?: string
  competitiveAnalysis?: { marketGaps?: unknown } | null
  brandVoice?: string
  positioningDirection?: string
  brandPersonality?: string[]
  colorPreferences?: string[]
  photoStyleNotes?: string
  propertyId?: string
}

type BrandApproved = {
  section_1_introduction?: { content?: string } | null
  section_2_positioning?: { statement?: string } | null
  section_3_target_audience?: { primary?: string } | null
  section_4_personas?: { personas?: Array<{ name?: string }> } | null
  section_5_name_story?: { name?: string } | null
  section_8_colors?: unknown
  [key: string]: unknown
}

// Initialize Google Auth for Vertex AI (for image generation)
let vertexAuth: GoogleAuth | null = null
const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID

if (process.env.GOOGLE_APPLICATION_CREDENTIALS && projectId) {
  const credentialsPath = path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS)
  vertexAuth = new GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  })
}

const SECTION_CONFIGS = {
  1: {
    name: 'introduction',
    title: 'Introduction & Market Context',
    prompt: (context: BrandContext) => `
Create an engaging introduction for the ${context.brandName || 'property'} brand book.

Context:
- Vision: ${context.vision}
- Target Audience: ${context.targetAudience}
- Market Analysis: ${JSON.stringify(context.competitiveAnalysis?.marketGaps)}

Write a 2-3 paragraph introduction that:
1. Opens with a compelling hook about the target audience
2. Introduces the brand concept
3. References the market opportunity

Output JSON:
{
  "content": "Opening paragraphs...",
  "marketInsights": ["insight 1", "insight 2", "insight 3"]
}
`
  },
  2: {
    name: 'positioning',
    title: 'Positioning Statement',
    prompt: (context: BrandContext, approved: BrandApproved) => `
Create a positioning statement for ${context.brandName || 'the property'}.

Approved Context:
- Introduction: ${approved.section_1_introduction?.content?.substring(0, 200)}...
- Vision: ${context.vision}
- Target: ${context.targetAudience}
- Brand Voice: ${context.brandVoice}
- Market Gap: ${context.positioningDirection}

Create:
1. A memorable 3-7 word positioning statement (like "Custom Crafted Carefree Living")
2. A 2-3 paragraph rationale explaining why this positioning works

Output JSON:
{
  "statement": "Positioning statement",
  "rationale": "Rationale paragraphs..."
}
`
  },
  3: {
    name: 'target_audience',
    title: 'Target Audience',
    prompt: (context: BrandContext, approved: BrandApproved) => `
Define the target audience for ${context.brandName}.

Approved Context:
- Positioning: ${approved.section_2_positioning?.statement}
- Brand Voice: ${context.brandVoice}

Create detailed target audience profile with:
1. Primary audience description (1 sentence)
2. Demographics (age, income, household, education, occupation)
3. Psychographics (5-7 traits/values)

Output JSON:
{
  "primary": "Primary audience description",
  "demographics": {
    "age": "range",
    "income": "range",
    "household": "description",
    "education": "level",
    "occupation": "types"
  },
  "psychographics": ["trait1", "trait2", "trait3", "trait4", "trait5"]
}
`
  },
  4: {
    name: 'personas',
    title: 'Resident Personas',
    prompt: (context: BrandContext, approved: BrandApproved) => `
Create 3 resident personas for ${context.brandName}.

Approved Context:
- Target Audience: ${JSON.stringify(approved.section_3_target_audience)}
- Positioning: ${approved.section_2_positioning?.statement}
- Brand Voice: ${context.brandVoice}

For each persona create:
- Name (first name only)
- Age
- Occupation/Background
- Personal quote (1-2 sentences in first person)
- Story (1 paragraph about their life and why this property fits)

Output JSON:
{
  "personas": [
    {
      "name": "Name",
      "age": 62,
      "occupation": "Occupation",
      "quote": "First person quote...",
      "story": "Paragraph about them..."
    }
  ]
}
`
  },
  5: {
    name: 'name_story',
    title: 'Brand Name & Story',
    prompt: (context: BrandContext, approved: BrandApproved) => `
Create the brand name and origin story.

Approved Context:
- Positioning: ${approved.section_2_positioning?.statement}
- Target Audience: ${approved.section_3_target_audience?.primary}
- Personas: ${approved.section_4_personas?.personas?.map(p => p.name).filter(Boolean).join(', ')}

Use suggested name: ${context.brandName}

Create:
1. Tagline (3-7 words, complements positioning)
2. Origin story (2-3 paragraphs about what the brand represents)
3. Rationale (why this name works for target audience)

Output JSON:
{
  "name": "${context.brandName}",
  "tagline": "Tagline",
  "story": "Origin story paragraphs...",
  "rationale": "Why this name works..."
}
`
  },
  6: {
    name: 'logo',
    title: 'Logo Design',
    generate: async (context: BrandContext, approved: BrandApproved) => {
      // Logo generation via Imagen
      if (!vertexAuth || !projectId) {
        throw new Error(
          'Vertex AI is not configured for BrandForge logo generation. Set GOOGLE_APPLICATION_CREDENTIALS and GOOGLE_CLOUD_PROJECT_ID.'
        )
      }

      const brandName = approved.section_5_name_story?.name || context.brandName
      const brandVoice = context.brandVoice
      const personality = context.brandPersonality?.join(', ')

      const prompt = `
Create a clean, professional logo for "${brandName}" - a multifamily property brand.

Style: ${brandVoice}, ${personality}
Requirements:
- Modern wordmark design
- Clean typography
- Professional and memorable
- Works in both color and black/white
- Scalable and versatile

Design should feel: ${personality}
`

      try {
        const client = await vertexAuth.getClient()
        const accessToken = await client.getAccessToken()

        if (!accessToken.token) {
          throw new Error('Failed to get access token')
        }

        const requestBody = {
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: '1:1',
            personGeneration: 'dont_allow'
          }
        }

        const location = 'us-central1'
        const modelId = 'imagen-3.0-generate-002'
        const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken.token}`
          },
          body: JSON.stringify(requestBody)
        })

        if (!response.ok) {
          throw new Error(`Logo generation failed: ${response.status}`)
        }

        const data = await response.json()
        const predictions = data.predictions || []

        if (predictions.length > 0 && predictions[0].bytesBase64Encoded) {
          const base64Data = predictions[0].bytesBase64Encoded
          
          // Upload to Supabase Storage
          const supabaseAdmin = createAdminClient()
          const fileName = `${context.propertyId}/logo-primary-${Date.now()}.png`
          const buffer = Buffer.from(base64Data, 'base64')
          
          const { error: uploadError } = await supabaseAdmin.storage
            .from('brand-assets')
            .upload(fileName, buffer, {
              contentType: 'image/png',
              upsert: true
            })

          if (uploadError) throw uploadError

          const { data: urlData } = supabaseAdmin.storage
            .from('brand-assets')
            .getPublicUrl(fileName)

          return {
            primary_url: urlData.publicUrl,
            variations: ['primary'],
            logoVariations: [urlData.publicUrl],
            design_rationale: `Logo designed to reflect ${brandVoice} brand voice with ${personality} personality. Clean, professional design that works across all applications.`
          }
        }

        throw new Error('No logo generated')
      } catch (error) {
        console.error('Logo generation error:', error)
        throw new Error(
          `Logo generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }
  },
  7: {
    name: 'typography',
    title: 'Typography System',
    prompt: (context: BrandContext, approved: BrandApproved) => `
Create typography system for ${approved.section_5_name_story?.name}.

Brand Voice: ${context.brandVoice}
Personality: ${context.brandPersonality?.join(', ')}

Define:
1. Headline font (font family, weight, usage rules)
2. Body font (font family, weight, usage)
3. Accent font (optional, for special emphasis)

Use professional, web-safe or Google Fonts.

Output JSON:
{
  "headline": {
    "font": "Font Name",
    "weight": "700",
    "usage": "Headlines, ALL CAPS"
  },
  "body": {
    "font": "Font Name",
    "weight": "400",
    "usage": "Body copy, Sentence case"
  },
  "accent": {
    "font": "Font Name",
    "usage": "Sparingly for warmth"
  }
}
`
  },
  8: {
    name: 'colors',
    title: 'Color Palette',
    prompt: (context: BrandContext, approved: BrandApproved) => `
Create color palette for ${approved.section_5_name_story?.name}.

Brand Voice: ${context.brandVoice}
Personality: ${context.brandPersonality?.join(', ')}
Color Preferences: ${context.colorPreferences?.join(', ')}

Create:
1. Primary color (name, hex, description)
2. Secondary color
3. 2-3 Accent colors
4. Usage guidelines (1 paragraph)

Colors should reflect brand personality and work well together.

Output JSON:
{
  "primary": {
    "name": "Color Name",
    "hex": "#HEXCODE",
    "description": "Usage description"
  },
  "secondary": {
    "name": "Color Name",
    "hex": "#HEXCODE",
    "description": "Usage description"
  },
  "accents": [
    {"name": "Color Name", "hex": "#HEXCODE"}
  ],
  "usageGuidelines": "How to use colors..."
}
`
  },
  9: {
    name: 'design_elements',
    title: 'Design Elements',
    prompt: (context: BrandContext, approved: BrandApproved) => `
Suggest unique design elements for ${approved.section_5_name_story?.name}.

Brand: ${context.brandVoice}, ${context.brandPersonality?.join(', ')}

Suggest 3-5 unique branded elements that could be created:
- Icons or badges
- Patterns or textures
- Special typography treatments
- Graphic elements

Output JSON:
{
  "elements": [
    {
      "type": "icon|pattern|texture",
      "name": "Element name",
      "description": "What it is and how to use it"
    }
  ],
  "usageNotes": "Overall guidance on using these elements"
}
`
  },
  10: {
    name: 'photo_yep',
    title: 'Photo Guidelines - Yep',
    prompt: (context: BrandContext, approved: BrandApproved) => `
Create photo style guidelines (GOOD examples) for ${approved.section_5_name_story?.name}.

Brand: ${context.brandVoice}
Target: ${approved.section_3_target_audience?.primary}
Colors: ${JSON.stringify(approved.section_8_colors)}
Photo Style Notes: ${context.photoStyleNotes}

Define:
1. Description (1 paragraph about good photo style)
2. Criteria (5-7 specific things good photos should have)

Output JSON:
{
  "description": "Beautiful pictures which convey...",
  "criteria": [
    "Natural lighting",
    "Authentic moments",
    "Complements color palette"
  ]
}
`
  },
  11: {
    name: 'photo_nope',
    title: 'Photo Guidelines - Nope',
    prompt: (context: BrandContext, approved: BrandApproved) => `
Create photo style guidelines (AVOID examples) for ${approved.section_5_name_story?.name}.

Create complementary "avoid" guidelines to the approved Yep section.

Define:
1. Description (what to avoid)
2. Criteria (5-7 specific things to avoid)

Output JSON:
{
  "description": "Avoid filters, embellishments...",
  "criteria": [
    "No stock photo clichés",
    "Avoid filters and heavy editing",
    "Not too young or too old for target"
  ]
}
`
  },
  12: {
    name: 'implementation',
    title: 'Implementation Examples',
    prompt: (context: BrandContext, approved: BrandApproved) => `
Suggest implementation examples for ${approved.section_5_name_story?.name}.

List 6-8 applications where the brand would appear:
- Stationery (business card, letterhead)
- Marketing collateral
- Signage
- Digital/website
- Merchandise

Output JSON:
{
  "examples": [
    {"type": "business_card", "description": "Professional business cards with logo"},
    {"type": "letterhead", "description": "Branded letterhead stationery"}
  ]
}
`
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { brandAssetId } = await req.json()

    if (!brandAssetId) {
      return NextResponse.json({ error: 'brandAssetId required' }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()

    // Get brand asset with all approved sections
    const { data: brandRaw, error: brandError } = await supabaseAdmin
      .from('property_brand_assets')
      .select('*')
      .eq('id', brandAssetId)
      .single()

    if (brandError || !brandRaw) {
      return NextResponse.json({ error: 'Brand asset not found' }, { status: 404 })
    }

    const propertyId = typeof brandRaw.property_id === 'string' ? brandRaw.property_id : null
    if (!propertyId) {
      return NextResponse.json({ error: 'Brand asset not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const brand = brandRaw as unknown as Record<string, unknown>
    const currentStep = asNumber(brand.current_step)
    if (!currentStep) {
      return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
    }

    const config = SECTION_CONFIGS[currentStep as keyof typeof SECTION_CONFIGS]

    if (!config) {
      return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
    }

    // Build context from conversation summary and approved sections
    const context: BrandContext = {
      ...(asRecord(brandRaw.conversation_summary) as BrandContext),
      propertyId,
      competitiveAnalysis: asRecord(brandRaw.competitive_analysis),
    }

    let generatedData

    if ('generate' in config && typeof config.generate === 'function') {
      // Custom generation (e.g., logo with Imagen)
      generatedData = await config.generate(context, brand as BrandApproved)
    } else if ('prompt' in config) {
      // Text generation with Gemini
      const prompt = config.prompt(context, brand as BrandApproved)
      const geminiConfigured = Boolean(process.env.GOOGLE_GEMINI_API_KEY)

      if (!geminiConfigured) {
        throw new Error('Gemini is not configured for BrandForge section generation.')
      } else {
        try {
          const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' })
          const result = await model.generateContent(prompt)
          const responseText = result.response.text()
          const jsonMatch = responseText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            generatedData = JSON.parse(jsonMatch[0])
          } else {
            throw new Error('Gemini returned invalid JSON for BrandForge section generation.')
          }
        } catch (generationError) {
          console.warn('Gemini generation failed:', generationError)
          throw new Error(
            `BrandForge section generation failed: ${
              generationError instanceof Error ? generationError.message : 'Unknown error'
            }`
          )
        }
      }
    }

    const updatePayload: Record<string, unknown> = {
      draft_section: {
        step: currentStep,
        name: config.name,
        data: generatedData,
        version: 1,
        status: 'reviewing',
        generated_at: new Date().toISOString()
      },
      generation_status: 'reviewing'
    }

    // Save as draft section
    await supabaseAdmin
      .from('property_brand_assets')
      .update(updatePayload as never)
      .eq('id', brandAssetId)

    return NextResponse.json({
      success: true,
      step: currentStep,
      sectionName: config.name,
      sectionTitle: config.title,
      data: generatedData
    })

  } catch (error) {
    console.error('Generate Section Error:', error)
    return NextResponse.json({ 
      error: 'Generation failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}



