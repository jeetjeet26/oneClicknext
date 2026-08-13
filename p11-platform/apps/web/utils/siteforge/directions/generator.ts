import type { SiteForgeBrief } from '@/utils/siteforge/briefs/contracts'
import {
  assertMateriallyDistinctDirections,
  hashSiteForgeDirection,
  siteForgeCreativeDirectionSchema,
  siteForgeDirectionPreviewSchema,
  type SiteForgeDirectionCandidate,
} from './contracts'

type SourceIdentity = {
  briefVersionId: string
  briefContentHash: string
  onboardingSnapshotId: string
  onboardingSnapshotHash: string
  brandAssetId: string
  brandContractHash: string
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') output.push(value.trim())
  else if (Array.isArray(value)) value.forEach(item => collectStrings(item, output))
  else if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(item =>
      collectStrings(item, output)
    )
  }
  return output.filter(Boolean)
}

function brandPalette(brand: Record<string, unknown>): string[] {
  const colors = collectStrings(brand.section_8_colors)
    .flatMap(value => value.match(/#[0-9a-f]{6}\b/gi) || [])
    .map(value => value.toUpperCase())
  return Array.from(
    new Set([
      ...colors,
      '#24324A',
      '#6F7C65',
      '#D68B5B',
      '#F7F4EE',
      '#172033',
    ])
  ).slice(0, 5)
}

function brandFonts(brand: Record<string, unknown>): [string, string] {
  const values = collectStrings(brand.section_7_typography).filter(value =>
    /[a-z]/i.test(value)
  )
  return [values[0] || 'Cormorant Garamond', values[1] || 'Inter']
}

export function generateDeterministicCreativeDirections(input: {
  brief: SiteForgeBrief
  brand: Record<string, unknown>
  sources: SourceIdentity
}): SiteForgeDirectionCandidate[] {
  const [primary, secondary, accent, background, text] = brandPalette(
    input.brand
  )
  const [headingFamily, bodyFamily] = brandFonts(input.brand)
  const audience = input.brief.audiences[0]?.segment || 'prospective residents'
  const objective = input.brief.objectives[0]?.statement || input.brief.summary
  const ctaLabel = input.brief.conversion.primaryAction
  const provenance = {
    generator: 'siteforge-deterministic-directions-v1' as const,
    briefVersionId: input.sources.briefVersionId,
    briefContentHash: input.sources.briefContentHash,
    onboardingSnapshotId: input.sources.onboardingSnapshotId,
    onboardingSnapshotHash: input.sources.onboardingSnapshotHash,
    brandAssetId: input.sources.brandAssetId,
    brandContractHash: input.sources.brandContractHash,
  }

  const raw = [
    {
      name: 'Editorial Confidence',
      direction: {
        rationale: `Build trust with ${audience} through a composed editorial system that makes ${objective.toLowerCase()} feel credible and enduring.`,
        typography: {
          headingFamily,
          bodyFamily,
          scale: 'Large display headlines balanced by compact editorial captions',
          weightStrategy: 'High contrast: expressive regular headings and sturdy medium body emphasis',
        },
        palette: { primary, secondary, accent, background, text },
        hero: {
          composition: 'Asymmetric split with a dominant property image and concise narrative column',
          headlineStyle: 'Short, aspirational statement with generous line breaks',
          mediaTreatment: 'Warm full-bleed photography with restrained editorial crops',
        },
        layout: {
          system: 'Twelve-column editorial grid with offset text and image modules',
          density: 'Airy',
          sectionRhythm: 'Long-form reveal alternating quiet copy and immersive imagery',
        },
        imagery: {
          style: 'Natural-light architectural editorial',
          subjects: ['Signature spaces', 'Resident-scale details', 'Neighborhood texture'],
          treatment: 'Wide crops, subtle grain, and minimal overlays',
        },
        cta: {
          label: ctaLabel,
          placement: 'Hero text column and a repeated editorial close',
          style: 'Underlined text action with one high-contrast filled companion',
        },
        voice: {
          traits: ['Assured', 'Refined', 'Human'],
          do: ['Lead with specific lived benefits', 'Use measured, evocative language'],
          dont: ['Overstate luxury', 'Use generic real-estate superlatives'],
        },
        tradeoffs: [
          'Creates a premium, trustworthy impression but relies on strong photography',
          'Prioritizes narrative depth over immediate information density',
        ],
        provenance,
      },
      previewManifest: {
        paletteSwatches: [primary, secondary, accent, background, text],
        heroMode: 'editorial-split',
        layoutMode: 'offset-grid',
        typographyPairing: `${headingFamily} / ${bodyFamily}`,
      },
    },
    {
      name: 'Conversion Clarity',
      direction: {
        rationale: `Reduce decision friction for ${audience} with a direct, utility-forward experience organized around ${ctaLabel.toLowerCase()}.`,
        typography: {
          headingFamily: bodyFamily,
          bodyFamily,
          scale: 'Compact responsive scale with prominent action and availability labels',
          weightStrategy: 'Medium and semibold weights for rapid scanning',
        },
        palette: {
          primary: secondary,
          secondary: primary,
          accent,
          background: '#FFFFFF',
          text,
        },
        hero: {
          composition: 'Information-led hero with benefit stack, availability cue, and persistent action',
          headlineStyle: 'Benefit-first headline followed by proof-oriented supporting copy',
          mediaTreatment: 'Structured image panel with practical amenity callouts',
        },
        layout: {
          system: 'Modular card grid with predictable conversion rails',
          density: 'Focused and information-rich',
          sectionRhythm: 'Short sections that alternate proof, inventory, and action',
        },
        imagery: {
          style: 'Bright, accurate, decision-supportive photography',
          subjects: ['Available residences', 'Amenities in use', 'Access and location'],
          treatment: 'Consistent ratios, descriptive captions, and minimal decoration',
        },
        cta: {
          label: ctaLabel,
          placement: 'Persistent header, hero, availability modules, and mobile action bar',
          style: 'High-contrast filled button with explicit outcome language',
        },
        voice: {
          traits: ['Clear', 'Useful', 'Encouraging'],
          do: ['Answer practical questions early', 'Pair claims with concrete proof'],
          dont: ['Hide availability behind narrative', 'Use ambiguous action labels'],
        },
        tradeoffs: [
          'Improves scanability and conversion access but feels less cinematic',
          'Requires disciplined content hierarchy to avoid visual density',
        ],
        provenance,
      },
      previewManifest: {
        paletteSwatches: [secondary, primary, accent, '#FFFFFF', text],
        heroMode: 'conversion-panel',
        layoutMode: 'modular-cards',
        typographyPairing: `${bodyFamily} / ${bodyFamily}`,
      },
    },
    {
      name: 'Immersive Place',
      direction: {
        rationale: `Differentiate the property by making place and atmosphere the primary story for ${audience}, then reveal conversion moments in context.`,
        typography: {
          headingFamily,
          bodyFamily,
          scale: 'Oversized cinematic display type with small supporting labels',
          weightStrategy: 'Light display headings paired with highly legible regular body copy',
        },
        palette: {
          primary: text,
          secondary: accent,
          accent: secondary,
          background: primary,
          text: background,
        },
        hero: {
          composition: 'Full-viewport scene with layered headline and an anchored exploration cue',
          headlineStyle: 'Atmospheric, place-led phrase with minimal supporting copy',
          mediaTreatment: 'Cinematic edge-to-edge sequence with controlled motion-ready crops',
        },
        layout: {
          system: 'Immersive full-width bands interrupted by intimate detail clusters',
          density: 'Experiential',
          sectionRhythm: 'Dramatic visual chapters with compact contextual interludes',
        },
        imagery: {
          style: 'Cinematic lifestyle and environmental storytelling',
          subjects: ['Arrival moments', 'Daily rituals', 'Neighborhood movement'],
          treatment: 'Layered crops, deep contrast, and occasional panoramic sequences',
        },
        cta: {
          label: ctaLabel,
          placement: 'Quiet hero anchor followed by contextual prompts after each visual chapter',
          style: 'Minimal outlined control that becomes filled on high-intent modules',
        },
        voice: {
          traits: ['Evocative', 'Distinctive', 'Inviting'],
          do: ['Write from sensory details', 'Connect place to daily routines'],
          dont: ['Let atmosphere obscure facts', 'Use abstract copy without proof'],
        },
        tradeoffs: [
          'Creates the strongest emotional differentiation but has the highest asset demands',
          'Needs careful accessibility controls for motion and image contrast',
        ],
        provenance,
      },
      previewManifest: {
        paletteSwatches: [text, accent, secondary, primary, background],
        heroMode: 'cinematic-full-bleed',
        layoutMode: 'immersive-bands',
        typographyPairing: `${headingFamily} / ${bodyFamily}`,
      },
    },
  ] as const

  const candidates = raw.map((candidate, index) => {
    const direction = siteForgeCreativeDirectionSchema.parse(
      candidate.direction
    )
    const previewManifest = siteForgeDirectionPreviewSchema.parse(
      candidate.previewManifest
    )
    const ordinal = index + 1
    return {
      ordinal,
      name: candidate.name,
      direction,
      previewManifest,
      contentHash: hashSiteForgeDirection({
        ordinal,
        name: candidate.name,
        direction,
        previewManifest,
      }),
    }
  })
  assertMateriallyDistinctDirections(candidates)
  return candidates
}
