import type { BrandForgeContractV1 } from '@/utils/brandforge/contracts'
import type { BrandContext } from '@/utils/siteforge/agents/brand-agent'
import {
  compileBrandPublicationPackage,
  type BrandPublicationPackage,
} from '@/utils/siteforge/brand-design-compiler'

export type ApprovedBrandAssetEvidence = {
  id: string
  fileUrl: string
  contentHash: string
}

type BoundLogo = {
  role: BrandForgeContractV1['logos']['variants'][number]['role']
  url: string
  assetId: string
  contentHash: string
}

function roleFont(contract: BrandForgeContractV1, role: 'headline' | 'body') {
  return contract.typography.roles.find(font => font.role === role)
}

export function normalizeBrandAssetUrl(value: string): string {
  const url = new URL(value.trim())
  url.hash = ''
  url.hostname = url.hostname.toLowerCase()
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = ''
  }
  url.searchParams.sort()
  return url.toString()
}

/**
 * Source-neutral BrandForge → SiteForge publication adapter. Generated and
 * imported contracts intentionally share this exact compilation boundary.
 */
export function compileBrandContractForSiteForge(
  contract: BrandForgeContractV1,
): BrandPublicationPackage {
  return compileBrandPublicationPackage(contract)
}

export function bindApprovedBrandLogos(
  contract: BrandForgeContractV1,
  approvedAssets: readonly ApprovedBrandAssetEvidence[]
): BoundLogo[] {
  const byId = new Map(approvedAssets.map(asset => [asset.id, asset]))
  const byUrl = new Map<string, ApprovedBrandAssetEvidence[]>()
  for (const asset of approvedAssets) {
    const normalized = normalizeBrandAssetUrl(asset.fileUrl)
    byUrl.set(normalized, [...(byUrl.get(normalized) || []), asset])
  }

  const seenUrls = new Set<string>()
  return contract.logos.variants.flatMap(variant => {
    const normalizedVariantUrl = variant.url
      ? normalizeBrandAssetUrl(variant.url)
      : null
    let matched: ApprovedBrandAssetEvidence | undefined

    if (variant.assetId) {
      const candidate = byId.get(variant.assetId)
      if (
        candidate &&
        (!normalizedVariantUrl ||
          normalizeBrandAssetUrl(candidate.fileUrl) === normalizedVariantUrl)
      ) {
        matched = candidate
      }
    } else if (normalizedVariantUrl) {
      const candidates = byUrl.get(normalizedVariantUrl) || []
      const contentHashes = new Set(candidates.map(candidate => candidate.contentHash))
      if (candidates.length > 0 && contentHashes.size === 1) {
        matched = [...candidates].sort((left, right) =>
          left.id.localeCompare(right.id)
        )[0]
      }
    }

    if (!matched) return []
    const normalizedMatchedUrl = normalizeBrandAssetUrl(matched.fileUrl)
    if (seenUrls.has(normalizedMatchedUrl)) return []
    seenUrls.add(normalizedMatchedUrl)
    return [{
      role: variant.role,
      url: matched.fileUrl,
      assetId: matched.id,
      contentHash: matched.contentHash,
    }]
  })
}

export function brandContextFromContract(
  contract: BrandForgeContractV1,
  approvedAssets?: readonly ApprovedBrandAssetEvidence[],
): BrandContext {
  const primaryColors = contract.colors.roles
    .filter(color => color.role === 'primary')
    .map(color => ({ name: color.name, hex: color.hex, usage: color.usage }))
  const secondaryColors = contract.colors.roles
    .filter(color => color.role !== 'primary')
    .map(color => ({ name: color.name, hex: color.hex, usage: color.usage }))
  const headline = roleFont(contract, 'headline')
  const body = roleFont(contract, 'body')
  const boundLogos = approvedAssets
    ? bindApprovedBrandLogos(contract, approvedAssets)
    : contract.logos.variants.flatMap(logo =>
        logo.url && logo.assetId
          ? [{
              role: logo.role,
              url: logo.url,
              assetId: logo.assetId,
              contentHash: undefined,
            }]
          : []
      )
  const primaryLogo =
    boundLogos.find(logo => logo.role === 'primary') || boundLogos[0]
  const logoVariations = boundLogos.filter(logo => logo !== primaryLogo)
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
      primaryContentHash: primaryLogo?.contentHash,
      variations: logoVariations.map(logo => logo.url),
      variantAssetIds: logoVariations.map(logo => logo.assetId),
      variantContentHashes: logoVariations.flatMap(logo =>
        logo.contentHash ? [logo.contentHash] : []
      ),
      concept: contract.identity.rationale,
      style: contract.logos.usageRules.join('; '),
    },
  }
}
