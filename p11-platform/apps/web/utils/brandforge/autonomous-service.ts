import { generateText, Output } from 'ai'
import {
  brandForgeGeneratedContentSchema,
  type BrandForgeContractV1,
  type BrandForgeGeneratedContent,
  type BrandForgeWorkflowInput,
  type CompetitivePositioningSnapshot,
} from './contracts'
import { normalizeBrandForgeContract } from './normalize'

const DEFAULT_BRANDFORGE_MODEL = 'anthropic/claude-sonnet-5'

type GeneratedInput = Extract<BrandForgeWorkflowInput, { mode: 'generated' }>
type StructuredGenerator = (prompt: string) => Promise<BrandForgeGeneratedContent>

function verticalLabel(vertical: BrandForgeWorkflowInput['vertical']): string {
  return vertical === 'for_sale_community'
    ? 'for-sale residential community'
    : 'multifamily rental community'
}

function snapshotProvenance(snapshot: CompetitivePositioningSnapshot) {
  return snapshot.evidence.map(item => ({
    sourceType: item.source.sourceType,
    sourceId: item.source.sourceId,
    ...(item.source.sourceUrl ? { sourceUrl: item.source.sourceUrl } : {}),
    ...(item.source.observedAt ? { capturedAt: item.source.observedAt } : {}),
    excerpt: [
      item.positioning,
      item.brandVoice,
      ...item.messagingThemes,
    ].filter(Boolean).join(' — '),
  }))
}

function deterministicGeneratedContent(
  input: GeneratedInput,
  snapshot: CompetitivePositioningSnapshot
): BrandForgeGeneratedContent {
  const { creativeBrief } = input
  const category = verticalLabel(input.vertical)
  const name = creativeBrief.brandName
  const voice = creativeBrief.brandVoice || 'clear, grounded, welcoming'
  const audience = creativeBrief.targetAudience || `People considering this ${category}`
  const gap = snapshot.marketGaps[0] || 'property-specific differentiation'
  const primary = creativeBrief.visualPreferences[0] || '#1F4B43'

  return brandForgeGeneratedContentSchema.parse({
    introduction: {
      content: `${name} is a ${category} brand built around ${creativeBrief.vision || 'a distinctive sense of place'}. Its expression is designed for ${audience}, with specific proof taking priority over generic category claims.`,
      marketInsights: snapshot.marketGaps,
    },
    positioning: {
      statement: `${name}: Distinctly at Home`,
      rationale: `This direction responds to ${gap} while remaining grounded in the supplied property vision. It is intended to distinguish the brand without copying competitor language.`,
      voice: [...new Set([voice, ...creativeBrief.personality])],
      prohibitedVoice: ['unsupported superlatives', 'competitor imitation', 'generic category clichés'],
    },
    audience: {
      primary: audience,
      demographics: {},
      psychographics: creativeBrief.personality.length > 0
        ? creativeBrief.personality
        : ['values clarity', 'seeks a strong sense of place'],
    },
    personas: {
      personas: [{
        name: 'Primary decision-maker',
        occupation: 'Prospective customer',
        quote: 'I want a place whose value and character are clear.',
        story: `Evaluates this ${category} through concrete details, visual coherence, and confidence in the experience.`,
      }],
    },
    identity: {
      name,
      tagline: 'Distinctly at Home',
      story: `${name} expresses ${creativeBrief.vision || 'a confident and welcoming place to call home'}.`,
      rationale: `The identity is direct, memorable, and adaptable across the ${category} customer journey.`,
    },
    logos: {
      variants: [],
      usageRules: ['Maintain clear space', 'Do not distort or recolor approved marks'],
    },
    typography: {
      roles: [
        { role: 'headline', family: 'Source Serif 4', weights: [600, 700], usage: 'Display headlines', fallback: 'Georgia, serif' },
        { role: 'body', family: 'Inter', weights: [400, 600], usage: 'Body copy and controls', fallback: 'Arial, sans-serif' },
      ],
    },
    colors: {
      roles: [
        { role: 'primary', name: 'Grounded Evergreen', hex: /^#[0-9a-f]{6}$/i.test(primary) ? primary : '#1F4B43', usage: 'Primary brand fields and actions' },
        { role: 'background', name: 'Warm Canvas', hex: '#F7F3EA', usage: 'Primary page background' },
        { role: 'text', name: 'Ink', hex: '#17211F', usage: 'Body copy and high-contrast text' },
        { role: 'accent', name: 'Clay', hex: '#C46F4E', usage: 'Selective emphasis' },
      ],
      usageGuidelines: 'Use the primary color for recognition, warm neutrals for space, and accent color sparingly.',
    },
    designElements: {
      elements: [{
        type: 'graphic-frame',
        name: 'Place Frame',
        description: 'A restrained framing device for property-specific imagery and proof.',
      }],
      usageNotes: 'Keep graphic elements subordinate to property evidence and approved photography.',
    },
    photographyYes: {
      description: `Use credible, place-specific photography that supports the ${category} experience.`,
      criteria: ['Natural light', 'Property-specific details', 'Human scale', 'Accurate representation'],
      exampleAssetIds: [],
    },
    photographyNo: {
      description: 'Avoid imagery that makes unsupported claims or obscures the actual place.',
      criteria: ['No competitor assets', 'No misleading composites', 'No generic lifestyle clichés'],
    },
    implementation: {
      examples: snapshot.websiteExpressionOpportunities.map((description, index) => ({
        type: `website_expression_${index + 1}`,
        description,
      })),
      lockedRules: ['Do not invent property facts', 'Do not reproduce competitor identity or copy'],
    },
  })
}

function generationPrompt(
  input: GeneratedInput,
  snapshot: CompetitivePositioningSnapshot
): string {
  return `Create one complete, coherent BrandForge contract content object for a ${verticalLabel(input.vertical)}.

The response must satisfy the supplied schema. Do not emit approval notes or ask for human approval.
Use competitive evidence as source material for differentiated positioning, never as permission to copy.
Do not invent property facts, demographics, amenities, pricing, availability, or legal claims.

Creative brief:
${JSON.stringify(input.creativeBrief)}

Typed MarketVision competitive positioning snapshot:
${JSON.stringify(snapshot)}

The identity, positioning, audience, voice, visual system, photography guidance, and implementation
must read as one system. Website implementation examples must be causally grounded in the snapshot.`
}

async function defaultStructuredGenerator(prompt: string): Promise<BrandForgeGeneratedContent> {
  const { output } = await generateText({
    model: process.env.BRANDFORGE_MODEL || DEFAULT_BRANDFORGE_MODEL,
    output: Output.object({ schema: brandForgeGeneratedContentSchema }),
    prompt,
  })
  return brandForgeGeneratedContentSchema.parse(output)
}

function generatedContract(
  content: BrandForgeGeneratedContent,
  snapshot: CompetitivePositioningSnapshot
): BrandForgeContractV1 {
  const provenance = snapshotProvenance(snapshot)
  const source = {
    ...content,
    introduction: {
      ...content.introduction,
      _meta: { provenance: { marketInsights: provenance } },
    },
    positioning: {
      ...content.positioning,
      _meta: { provenance: { statement: provenance, rationale: provenance } },
    },
    implementation: {
      ...content.implementation,
      _meta: { provenance: { examples: provenance } },
    },
  }
  return normalizeBrandForgeContract(source, {
    origin: 'generated',
    approvalStatus: 'approved',
    confidence: snapshot.evidence.length > 0 ? 0.85 : 0.65,
  })
}

export function applyCompetitiveWebsiteExpression(
  contract: BrandForgeContractV1,
  snapshot: CompetitivePositioningSnapshot
): BrandForgeContractV1 {
  const provenance = snapshotProvenance(snapshot)
  const ready = <T extends { _meta: BrandForgeContractV1['identity']['_meta'] }>(
    section: T
  ): T => ({
    ...section,
    _meta: {
      ...section._meta,
      approval: { status: 'approved' },
    },
  })
  return normalizeBrandForgeContract({
    ...contract,
    introduction: ready(contract.introduction),
    positioning: ready(contract.positioning),
    audience: ready(contract.audience),
    personas: ready(contract.personas),
    identity: ready(contract.identity),
    logos: ready(contract.logos),
    typography: ready(contract.typography),
    colors: ready(contract.colors),
    designElements: ready(contract.designElements),
    photographyYes: ready(contract.photographyYes),
    photographyNo: ready(contract.photographyNo),
    implementation: {
      ...ready(contract.implementation),
      examples: [
        ...contract.implementation.examples.filter(example =>
          !example.type.startsWith('website_expression_')
        ),
        ...snapshot.websiteExpressionOpportunities.map((description, index) => ({
          type: `website_expression_${index + 1}`,
          description,
        })),
      ],
      _meta: {
        ...contract.implementation._meta,
        provenance: {
          ...contract.implementation._meta.provenance,
          examples: provenance,
        },
      },
    },
  }, {
    origin: contract.origin,
    approvalStatus: 'approved',
    confidence: contract.implementation._meta.confidence,
  })
}

export async function convergeBrandForgeContract(
  input: BrandForgeWorkflowInput,
  snapshot: CompetitivePositioningSnapshot,
  generate: StructuredGenerator = defaultStructuredGenerator
): Promise<{ contract: BrandForgeContractV1; generation: 'model' | 'deterministic' | 'supplied' }> {
  if (input.mode === 'supplied') {
    return {
      contract: applyCompetitiveWebsiteExpression(input.suppliedContract, snapshot),
      generation: 'supplied',
    }
  }

  try {
    const content = await generate(generationPrompt(input, snapshot))
    return {
      contract: generatedContract(content, snapshot),
      generation: 'model',
    }
  } catch (error) {
    console.warn('[brandforge] structured generation unavailable; using deterministic fallback', {
      propertyId: input.propertyId,
      reason: error instanceof Error ? error.message : String(error),
    })
    return {
      contract: generatedContract(
        deterministicGeneratedContent(input, snapshot),
        snapshot
      ),
      generation: 'deterministic',
    }
  }
}
