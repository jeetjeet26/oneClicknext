import type {
  BlueprintPatchOperation,
  GeneratedPage,
  PageSection,
  SiteBlueprint,
} from '@/types/siteforge'
import { createServiceClient } from '@/utils/supabase/admin'
import type { SiteForgeEditorSnapshot } from './context'
import type {
  RuntimeExtensionRequest,
  SiteForgeEditorAgentResult,
} from './agent'

const REPLAY_MODEL = 'siteforge-aurora-replay-v1'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

type NavigationItem = {
  id: string
  label: string
  href: string
  parentId?: string
  external?: boolean
}

function navigationItems(value: unknown): NavigationItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((value) => {
    const item = record(value)
    if (
      typeof item.id !== 'string' ||
      typeof item.label !== 'string' ||
      typeof item.href !== 'string'
    ) {
      return []
    }
    return [
      {
        id: item.id,
        label: item.label,
        href: item.href,
        ...(typeof item.parentId === 'string'
          ? { parentId: item.parentId }
          : {}),
        ...(typeof item.external === 'boolean'
          ? { external: item.external }
          : {}),
      },
    ]
  })
}

type ApprovedAsset = {
  id: string
  assetType: string
  fileUrl: string
  altText: string | null
  width: number | null
  height: number | null
  mimeType: string | null
}

function approvedAssets(value: unknown): ApprovedAsset[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((value) => {
    const asset = record(value)
    if (
      typeof asset.id !== 'string' ||
      typeof asset.asset_type !== 'string' ||
      typeof asset.file_url !== 'string'
    ) {
      return []
    }
    return [
      {
        id: asset.id,
        assetType: asset.asset_type,
        fileUrl: asset.file_url,
        altText: typeof asset.alt_text === 'string' ? asset.alt_text : null,
        width: typeof asset.width === 'number' ? asset.width : null,
        height: typeof asset.height === 'number' ? asset.height : null,
        mimeType: typeof asset.mime_type === 'string' ? asset.mime_type : null,
      },
    ]
  })
}

function blueprint(snapshot: SiteForgeEditorSnapshot): SiteBlueprint {
  return snapshot.artifact.blueprint as unknown as SiteBlueprint
}

function pages(snapshot: SiteForgeEditorSnapshot): GeneratedPage[] {
  return blueprint(snapshot).pages as GeneratedPage[]
}

function page(snapshot: SiteForgeEditorSnapshot, slug: string): GeneratedPage {
  const match = pages(snapshot).find(candidate => candidate.slug === slug)
  if (!match) throw new Error(`Aurora replay requires page "${slug}"`)
  return structuredClone(match)
}

function section(
  snapshot: SiteForgeEditorSnapshot,
  predicate: (candidate: PageSection) => boolean
): PageSection {
  const match = pages(snapshot)
    .flatMap(candidate => candidate.sections)
    .find(predicate)
  if (!match?.id) throw new Error('Aurora replay section identity is missing')
  return match
}

function result(
  response: string,
  operations: BlueprintPatchOperation[],
  tools: string[],
  extensionRequest: RuntimeExtensionRequest | null = null
): SiteForgeEditorAgentResult {
  return {
    response,
    model: REPLAY_MODEL,
    operations,
    extensionRequest,
    clarification: null,
    toolSummary: tools.map(tool => ({
      tool,
      detail: `Deterministic Aurora replay used ${tool}`,
    })),
  }
}

function pageSeo(title: string, description: string, canonicalPath: string) {
  return {
    title,
    description,
    canonicalPath,
    noIndex: false,
    structuredData: ['WebPage', 'BreadcrumbList'],
  }
}

function extension(): RuntimeExtensionRequest {
  return {
    capability: 'accessible-floorplan-comparison-control',
    reason:
      'The reviewed client-side comparison interaction is outside semantic block operations.',
    requestedBehavior:
      'Add a keyboard-operable floor-plan comparison control that uses only rendered plan data and respects reduced motion.',
    overlay: {
      reason:
        'Add the governed accessible floor-plan comparison interaction (deterministic replay v2).',
      files: [
        {
          path: 'assets/css/floorplan-compare.css',
          content:
            '.siteforge-floorplan-compare{display:grid;gap:1rem}.siteforge-floorplan-compare button:focus-visible{outline:3px solid #D4A72C;outline-offset:3px}@media (prefers-reduced-motion:reduce){.siteforge-floorplan-compare *{transition:none!important}}',
        },
        {
          path: 'assets/js/floorplan-compare.js',
          content:
            'document.addEventListener("DOMContentLoaded",()=>{document.querySelectorAll(".siteforge-resource-floor-plans").forEach((root)=>{if(root.querySelector("[data-siteforge-compare]"))return;const button=document.createElement("button");button.type="button";button.dataset.siteforgeCompare="true";button.textContent="Compare selected floor plans";button.addEventListener("click",()=>button.setAttribute("aria-pressed",button.getAttribute("aria-pressed")==="true"?"false":"true"));root.appendChild(button);});});',
        },
      ],
    },
  }
}

export function isAuroraSemanticReplayEnabled(): boolean {
  return process.env.SITEFORGE_AURORA_SEMANTIC_REPLAY === 'true'
}

export async function runAuroraSemanticReplay(input: {
  snapshot: SiteForgeEditorSnapshot
  userIntent: string
}): Promise<SiteForgeEditorAgentResult> {
  if (
    process.env.SITEFORGE_AURORA_LIFECYCLE_CONTROL_ENABLED !== 'true' ||
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error(
      'Aurora semantic replay is restricted to enabled non-production lifecycle control'
    )
  }
  const intent = input.userIntent.toLowerCase()
  if (intent.startsWith('copy:')) {
    const intro = section(
      input.snapshot,
      candidate =>
        candidate.acfBlock === 'acf/text-section' &&
        !String(candidate.type).includes('legal')
    )
    const confirmedPlan = record(record(blueprint(input.snapshot)).confirmedPlan)
    const facts = Array.isArray(confirmedPlan.knownFacts)
      ? confirmedPlan.knownFacts.map(record)
      : []
    const evidenceIds = facts.flatMap(fact =>
      Array.isArray(fact.evidenceIds)
        ? fact.evidenceIds.filter(
            (evidenceId): evidenceId is string => typeof evidenceId === 'string'
          )
        : []
    )
    return result(
      'Revised the homepage with exact approved Aurora facts.',
      [
        {
          version: 2,
          op: 'section.update',
          sectionId: intro.id!,
          value: {
            content: {
              headline: 'Aurora Lifecycle Test',
              content:
                'The property is named Aurora Lifecycle Test. Aurora Lifecycle Test is located at 1 Aurora Test Way, Austin, TX 78701. Aurora Lifecycle Test has 280 units.',
              layout: 'center',
              background: 'white',
            },
            label: 'Aurora property overview',
            purpose: 'Present exact approved property facts.',
            evidenceIds,
          },
        },
      ],
      ['inspectSite', 'applySemanticOperations']
    )
  }
  if (intent.startsWith('topology:')) {
    return result(
      'Added the governed amenities page.',
      [
        {
          version: 2,
          op: 'page.upsert',
          page: {
            slug: 'amenities',
            title: 'Amenities',
            purpose: 'Present approved Aurora amenities.',
            seo: pageSeo(
              'Aurora Amenities',
              'Review approved amenities at Aurora Lifecycle Test in Austin, including the pool and fitness center.',
              '/amenities/'
            ),
            sections: [
              {
                id: 'amenities-overview',
                type: 'amenities',
                acfBlock: 'acf/text-section',
                order: 0,
                content: {
                  headline: 'Approved amenities',
                  content:
                    'Approved amenities include a pool and fitness center.',
                  layout: 'center',
                  background: 'white',
                },
                reasoning: 'Use the exact approved amenities claim.',
                evidenceIds: [
                  `property-profile:${input.snapshot.website.propertyId}:amenities`,
                ],
              },
            ],
          },
        },
      ],
      ['inspectSite', 'applySemanticOperations']
    )
  }
  if (intent.startsWith('navigation and footer:')) {
    const configuration = record(
      record(blueprint(input.snapshot)).siteConfiguration
    )
    const navigation = record(configuration.navigation)
    const items = navigationItems(navigation.items).filter(
      (item) => item.id !== 'amenities'
    )
    return result(
      'Exposed amenities in navigation and footer.',
      [
        {
          version: 2,
          op: 'navigation.update',
          value: {
            items: [
              ...items,
              {
                id: 'amenities',
                label: 'Amenities',
                href: '/amenities/',
              },
            ],
          },
        },
        {
          version: 2,
          op: 'footer.update',
          value: {
            tagline: 'Aurora Lifecycle Test · Austin, Texas',
          },
        },
      ],
      ['inspectSite', 'applySemanticOperations']
    )
  }
  if (intent.startsWith('forms:')) {
    const legal = record(record(blueprint(input.snapshot)).legal)
    const policyBodies = record(legal.policyBodies)
    const consent =
      typeof policyBodies.communicationsConsent === 'string'
        ? policyBodies.communicationsConsent
        : 'I consent to be contacted about this property.'
    return result(
      'Added exact contact and tour forms with approved consent.',
      [
        {
          version: 2,
          op: 'page.upsert',
          page: {
            slug: 'contact',
            title: 'Contact',
            purpose: 'Provide governed contact and tour request paths.',
            seo: pageSeo(
              'Contact Aurora Lifecycle Test',
              'Contact the Aurora Lifecycle Test property team or request a tour of the Austin community.',
              '/contact/'
            ),
            sections: [
              {
                id: 'contact-form',
                type: 'contact-form',
                acfBlock: 'acf/form',
                order: 0,
                content: {
                  heading: 'Contact the property team',
                  subheading:
                    'Aurora Lifecycle Test is located at 1 Aurora Test Way, Austin, TX 78701.',
                  form_type: 'contact',
                  provider: 'p11_lumaleasing',
                  consent_text: consent,
                },
                reasoning: 'Use the verified contact provider and consent.',
                evidenceIds: [
                  `property-profile:${input.snapshot.website.propertyId}:address`,
                ],
              },
              {
                id: 'tour-form',
                type: 'tour-form',
                acfBlock: 'acf/form',
                order: 1,
                content: {
                  heading: 'Request a tour',
                  subheading: 'Choose a preferred date to visit.',
                  form_type: 'tour',
                  provider: 'p11_lumaleasing',
                  consent_text: consent,
                },
                reasoning: 'Use the verified tour provider and consent.',
                evidenceIds: [],
              },
            ],
          },
        },
      ],
      ['inspectSite', 'applySemanticOperations']
    )
  }
  if (intent.startsWith('seo and redirects:')) {
    const amenities = page(input.snapshot, 'amenities')
    amenities.seo = pageSeo(
      'Aurora Amenities',
      'Explore the approved pool and fitness center amenities at Aurora Lifecycle Test in Austin, Texas.',
      '/amenities/'
    )
    return result(
      'Updated exact amenities SEO while preserving managed redirects.',
      [{ version: 2, op: 'page.upsert', page: amenities }],
      ['inspectSite', 'applySemanticOperations']
    )
  }
  if (intent.startsWith('media:')) {
    const assets = approvedAssets(input.snapshot.approvedAssets)
    const logo = assets.find(asset => asset.assetType === 'logo')
    const image =
      assets.find(asset => asset.assetType === 'image') || logo
    if (!logo || !image) {
      throw new Error('Aurora replay approved media is unavailable')
    }
    const amenities = page(input.snapshot, 'amenities')
    const afterSectionId = amenities.sections.at(-1)?.id
    return result(
      'Applied only governed Aurora media.',
      [
        {
          version: 2,
          op: 'media.update',
          value: {
            logoAssetId: logo.id,
            logoUrl: logo.fileUrl,
            logoAlt: logo.altText || 'Aurora Lifecycle Test logo',
            defaultImageUrl: image.fileUrl,
            imageTreatment: 'editorial',
          },
        },
        {
          version: 2,
          op: 'section.upsert',
          pageSlug: 'amenities',
          sectionId: 'amenities-media',
          ...(afterSectionId ? { afterSectionId } : {}),
          section: {
            type: 'amenities-media',
            acfBlock: 'acf/image',
            content: {
              image: {
                assetId: image.id,
                url: image.fileUrl,
                alt:
                  image.altText ||
                  'Aurora Lifecycle Test property graphic',
                ...(image.width ? { width: image.width } : {}),
                ...(image.height ? { height: image.height } : {}),
                mimeType: image.mimeType || 'image/png',
              },
              size: 'large',
              caption: 'Aurora Lifecycle Test',
            },
            label: 'Approved Aurora media',
            purpose: 'Display governed property media.',
            reasoning: 'Use only the approved immutable media identity.',
            evidenceIds: [],
          },
        },
      ],
      ['inspectSite', 'searchAssets', 'applySemanticOperations']
    )
  }
  if (intent.startsWith('knowledge:')) {
    const { data, error } = await createServiceClient()
      .from('documents')
      .select('id, content')
      .eq('property_id', input.snapshot.website.propertyId)
      .contains('metadata', { auroraLifecycleFixture: true })
      .limit(1)
      .maybeSingle()
    if (error || !data) throw new Error('Aurora replay knowledge is unavailable')
    const home = page(input.snapshot, 'home')
    const afterSectionId = home.sections.at(-1)?.id
    return result(
      'Added exact tenant-scoped neighborhood knowledge.',
      [
        {
          version: 2,
          op: 'section.upsert',
          pageSlug: 'home',
          sectionId: 'neighborhood-knowledge',
          ...(afterSectionId ? { afterSectionId } : {}),
          section: {
            type: 'neighborhood',
            acfBlock: 'acf/text-section',
            content: {
              headline: 'Austin location',
              content: data.content,
              layout: 'left',
              background: 'light',
            },
            label: 'Approved neighborhood knowledge',
            purpose: 'Present exact tenant-scoped knowledge evidence.',
            reasoning: 'Use the approved property knowledge document verbatim.',
            evidenceIds: [data.id],
          },
        },
      ],
      ['inspectSite', 'searchKnowledge', 'applySemanticOperations']
    )
  }
  if (intent.startsWith('responsive:')) {
    return result(
      'Applied deterministic responsive spacing.',
      [
        {
          version: 2,
          op: 'design.update',
          value: {
            spacing: {
              containerMaxWidth: '1280px',
              sectionPadding: '5rem',
            },
          },
        },
      ],
      ['inspectSite', 'applySemanticOperations']
    )
  }
  if (intent.startsWith('accessibility:')) {
    const intro = section(
      input.snapshot,
      candidate =>
        candidate.acfBlock === 'acf/text-section' &&
        !String(candidate.type).includes('legal')
    )
    return result(
      'Improved semantic labels without changing approved copy.',
      [
        {
          version: 2,
          op: 'section.update',
          sectionId: intro.id!,
          value: {
            label: 'Aurora Lifecycle Test property overview',
            purpose:
              'Provide a clearly labeled primary property information region.',
          },
        },
      ],
      ['inspectSite', 'applySemanticOperations']
    )
  }
  if (intent.startsWith('custom interaction:')) {
    return result(
      'Prepared the deterministic governed extension proposal.',
      [],
      ['inspectSite', 'requestCapabilityExtension'],
      extension()
    )
  }
  throw new Error(`Aurora semantic replay does not support intent: ${input.userIntent}`)
}
