import { NextRequest } from 'next/server'
import { z } from 'zod'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { runBrandCommand, savedDraft } from '@/utils/brandforge/operations'
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '')
export async function POST(request: NextRequest) {
 return runBrandCommand(request, 'regenerate', { hint: z.string().trim().max(2000).optional() }, async ({ body: { hint }, brand: brandRaw }) => {
 const draftSection = savedDraft(brandRaw)
    const currentData = draftSection.data

    // Build regeneration prompt
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    
    const regenerationPrompt = `
You previously generated this ${draftSection.name} section:
${JSON.stringify(currentData, null, 2)}

${hint ? `User feedback: "${hint}"` : 'Generate a new, different version.'}

Context:
${JSON.stringify(brandRaw.conversation_summary)}

Approved sections:
${JSON.stringify({
  introduction: brandRaw.section_1_introduction,
  positioning: brandRaw.section_2_positioning,
  targetAudience: brandRaw.section_3_target_audience,
  personas: brandRaw.section_4_personas,
  nameStory: brandRaw.section_5_name_story
})}

Generate a NEW version for the ${draftSection.name} section. Make it distinct from the previous version.
Output ONLY valid JSON matching the same structure.
`

    const result = await model.generateContent(regenerationPrompt)
    const responseText = result.response.text()
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Failed to extract JSON from regeneration')
    }

    const regeneratedData = JSON.parse(jsonMatch[0])

    // Update draft section with new version
    const updatePayload: Record<string, unknown> = {
      draft_section: {
        ...draftSection,
        data: regeneratedData,
        version: (draftSection.version || 1) + 1,
        regenerated_at: new Date().toISOString()
      }
    }

    return { updates: updatePayload, result: { step: draftSection.step, sectionName: draftSection.name, data: regeneratedData, version: draftSection.version + 1 } }
 })
}
