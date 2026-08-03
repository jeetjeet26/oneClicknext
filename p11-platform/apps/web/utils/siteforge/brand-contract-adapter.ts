import type { BrandForgeContractV1 } from '@/utils/brandforge/contracts'
import type { BrandContext } from '@/utils/siteforge/agents/brand-agent'

function roleFont(contract: BrandForgeContractV1, role: 'headline' | 'body') {
  return contract.typography.roles.find(font => font.role === role)
}

export function brandContextFromContract(
  contract: BrandForgeContractV1,
): BrandContext {
  const primaryColors = contract.colors.roles
    .filter(color => color.role === 'primary')
    .map(color => ({ name: color.name, hex: color.hex, usage: color.usage }))
  const secondaryColors = contract.colors.roles
    .filter(color => color.role !== 'primary')
    .map(color => ({ name: color.name, hex: color.hex, usage: color.usage }))
  const headline = roleFont(contract, 'headline')
  const body = roleFont(contract, 'body')
  const primaryLogo = contract.logos.variants.find(logo => logo.role === 'primary')
  const voice = contract.positioning.voice

  return {
    source: contract.origin === 'hybrid' ? 'hybrid' : 'brandforge',
    confidence: Math.min(
      ...[
        contract.identity._meta.confidence,
        contract.positioning._meta.confidence,
        contract.colors._meta.confidence,
        contract.typography._meta.confidence,
      ],
    ),
    brandPersonality: {
      primary: voice[0] || 'authentic',
      traits: voice,
      avoid: contract.positioning.prohibitedVoice,
    },
    visualIdentity: {
      moodKeywords: contract.designElements.elements.map(element => element.name),
      colorMood: contract.colors.usageGuidelines,
      photoStyle: {
        lighting: contract.photographyYes.criteria.find(item => /light/i.test(item)) || 'Follow approved photography guidance',
        composition: contract.photographyYes.criteria.find(item => /compos|framing/i.test(item)) || 'Authentic property-first composition',
        subjects: contract.photographyYes.criteria.join('; '),
        mood: contract.photographyYes.description,
      },
      designStyle: contract.designElements.usageNotes || contract.positioning.rationale,
    },
    targetAudience: {
      demographics: Object.values(contract.audience.demographics).join(', '),
      psychographics: contract.audience.psychographics.join(', '),
      priorities: contract.audience.psychographics,
      painPoints: [],
    },
    positioning: {
      category: contract.identity.name,
      differentiators: contract.introduction.marketInsights,
      competitiveAdvantage: contract.positioning.statement,
      messagingPillars: [
        contract.identity.tagline,
        ...contract.introduction.marketInsights,
      ].filter(Boolean),
    },
    contentStrategy: {
      voiceTone: voice.join(', ') || 'Clear and authentic',
      vocabularyUse: voice,
      vocabularyAvoid: contract.positioning.prohibitedVoice,
      headlineStyle: contract.identity.tagline || contract.positioning.statement,
      storytellingFocus: contract.identity.story || contract.introduction.content,
    },
    designPrinciples: [
      ...contract.logos.usageRules,
      ...contract.implementation.lockedRules,
    ],
    colorPalette: {
      primary: primaryColors,
      secondary: secondaryColors,
    },
    typography: headline && body ? {
      primaryFont: headline.family,
      primaryUsage: headline.usage,
      secondaryFont: body.family,
      secondaryUsage: body.usage,
    } : undefined,
    logoAssets: {
      primaryUrl: primaryLogo?.url,
      primaryAssetId: primaryLogo?.assetId,
      variations: contract.logos.variants
        .filter(logo => logo !== primaryLogo)
        .flatMap(logo => logo.url ? [logo.url] : []),
      variantAssetIds: contract.logos.variants
        .filter(logo => logo !== primaryLogo)
        .flatMap(logo => logo.assetId ? [logo.assetId] : []),
      concept: contract.identity.rationale,
      style: contract.logos.usageRules.join('; '),
    },
  }
}
