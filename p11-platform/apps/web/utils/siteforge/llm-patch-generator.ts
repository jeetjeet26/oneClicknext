// SiteForge LLM Patch Generator
// Converts user intent into structured blueprint patches
// Uses Claude Sonnet 4 with WordPress awareness
// Created: December 16, 2025

import Anthropic from '@anthropic-ai/sdk'
import { WordPressMcpClient } from '@/utils/mcp/wordpress-client'
import type { SiteBlueprint, BlueprintPatchOperation } from '@/types/siteforge'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!
})

/**
 * Generate blueprint patches from user intent
 * Uses Claude Sonnet 4 to translate intent into structured operations
 */
export async function generateBlueprintPatches(
  blueprint: SiteBlueprint,
  selectedSectionId: string,
  userIntent: string
): Promise<BlueprintPatchOperation[]> {
  
  // Find the selected section
  const section = findSectionById(blueprint, selectedSectionId)
  if (!section) {
    throw new Error(`Section not found: ${selectedSectionId}`)
  }
  
  // Get WordPress capabilities
  const wpMcp = new WordPressMcpClient()
  const wpCapabilities = await wpMcp.getCapabilities()
  
  const systemPrompt = `You are a SiteForge blueprint editor. You translate user editing intents into structured blueprint patch operations.

Your patches must:
1. Use ONLY blocks from available WordPress blocks
2. Preserve section structure and IDs
3. Follow brand context guidelines
4. Be valid according to BlueprintPatchOperation schema
5. Preserve a polished, property-specific quality bar without copying any reference property.`
  
  const prompt = `
The user wants to edit a website section.

# CURRENT SECTION:
${JSON.stringify(section, null, 2)}

# CURRENT PAGE CONTEXT:
${JSON.stringify(findPageContainingSection(blueprint, selectedSectionId), null, 2)}

# USER REQUEST:
"${userIntent}"

# BRAND CONTEXT:
${JSON.stringify(blueprint.brandContext, null, 2)}

# WORDPRESS CAPABILITIES:
Available Blocks: ${wpCapabilities.availableBlocks.join(', ')}
Block Schemas: ${JSON.stringify(wpCapabilities.blockSchemas, null, 2)}

# PATCH OPERATION TYPES:

1. update_section - Modify content/variant/css of existing section
{
  "op": "update_section",
  "sectionId": "${selectedSectionId}",
  "content": { /* updated content */ },
  "variant": "optional - change variant",
  "cssClasses": ["optional", "new-classes"],
  "reasoning": "Why this achieves user intent"
}

2. add_section - Add new section after this one
{
  "op": "add_section",
  "pageSlug": "current-page-slug",
  "afterSectionId": "${selectedSectionId}",
  "section": {
    "type": "amenity",
    "acfBlock": "acf/content-grid",
    "content": { /* content */ },
    "reasoning": "Why adding this section"
  }
}

3. remove_section - Delete this section
{
  "op": "remove_section",
  "sectionId": "${selectedSectionId}"
}

4. move_section - Reorder section
{
  "op": "move_section",
  "sectionId": "${selectedSectionId}",
  "toOrder": 2
}

# YOUR TASK:

Generate patch operations that implement the user's intent.

Common intents:
- "Make this more luxury" → update variant + css classes + refine copy
- "Add pricing info" → update content with pricing data
- "Make headline bigger" → update css classes
- "Add a pool photo" → update photoRequirement
- "Move this section up" → move_section
- "Remove this" → remove_section

# OUTPUT (JSON array):

[
  {
    "op": "update_section",
    "sectionId": "${selectedSectionId}",
    "content": { /* updated based on intent */ },
    "reasoning": "How this implements user intent"
  }
]

# CRITICAL RULES:

1. Preserve sectionId (never change it)
2. Use ONLY blocks from availableBlocks
3. If changing block type, ensure variant exists in blockSchemas
4. Content must match brand voice from brandContext
5. Multiple patches if intent requires multiple changes
6. Reasoning must explain how patch achieves intent

Generate patches now.
`
  
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    temperature: 1.0,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  })
  
  const textContent = message.content.find(c => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Claude returned no text content')
  }
  
  // Extract JSON from response
  let responseText = textContent.text
  const jsonMatch = responseText.match(/\[[\s\S]*\]/)
  if (jsonMatch) {
    responseText = jsonMatch[0]
  }
  
  try {
    const patches = JSON.parse(responseText)
    
    // Validate patches
    validatePatches(patches, wpCapabilities.availableBlocks)
    
    return patches as BlueprintPatchOperation[]
  } catch (e) {
    console.error('Failed to parse patches:', e)
    console.error('Response:', responseText)
    throw new Error('LLM returned invalid patch format')
  }
}

/**
 * Find section by ID in blueprint
 */
function findSectionById(blueprint: SiteBlueprint, sectionId: string): any {
  for (const page of blueprint.pages) {
    for (const section of page.sections || []) {
      if (section.id === sectionId) {
        return section
      }
    }
  }
  return null
}

/**
 * Find page containing section
 */
function findPageContainingSection(blueprint: SiteBlueprint, sectionId: string): any {
  for (const page of blueprint.pages) {
    for (const section of page.sections || []) {
      if (section.id === sectionId) {
        return page
      }
    }
  }
  return null
}

/**
 * Validate patches against schema and WordPress capabilities
 */
function validatePatches(
  patches: BlueprintPatchOperation[],
  availableBlocks: string[]
): void {
  
  for (const patch of patches) {
    // Validate operation type
    if (!['update_section', 'add_section', 'remove_section', 'move_section'].includes(patch.op)) {
      throw new Error(`Invalid patch operation: ${patch.op}`)
    }
    
    // Validate add_section has valid block
    if (patch.op === 'add_section') {
      if (!patch.section?.acfBlock) {
        throw new Error('add_section must specify acfBlock')
      }
      if (!availableBlocks.includes(patch.section.acfBlock)) {
        throw new Error(`Block not available: ${patch.section.acfBlock}`)
      }
    }
  }
}










