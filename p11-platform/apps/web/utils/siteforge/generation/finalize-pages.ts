import type {
  ACFBlockType,
  GeneratedPage,
  PageSection,
} from '@/types/siteforge'
import type {
  Photo,
  PhotoManifest,
} from '@/utils/siteforge/agents/photo-agent'
import {
  strictGeneratedPageSchema,
  type StrictSiteForgePageSection,
} from '@/utils/siteforge/block-schemas'
import type { ApprovedFloorPlanSnapshot } from '@/utils/siteforge/providers/floor-plans'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import type { Tables } from '@/types/supabase'
import {
  legalEvidenceId,
  type SiteForgeLegalConfig,
} from '@/utils/siteforge/quality/deterministic-gates'

type ApprovedPointOfInterest = Pick<
  Tables<'property_points_of_interest'>,
  | 'name'
  | 'category'
  | 'address'
  | 'distance_miles'
  | 'travel_time_minutes'
  | 'source_url'
>

export type SourcedMapLocation = {
  address?: string
  latitude?: number
  longitude?: number
}

export type SiteForgeFinalizationIntegrityContext = {
  mapLocation?: SourcedMapLocation
  formProviders?: {
    lead: 'p11_lumaleasing' | 'csv_export' | 'unconfigured'
    tour: 'p11_lumaleasing' | 'external_url' | 'unconfigured'
  }
}

const EMPTY_FLOOR_PLAN_SNAPSHOT: ApprovedFloorPlanSnapshot = {
  capturedAt: '1970-01-01T00:00:00.000Z',
  contentHash: hashSiteForgeContent([]),
  rows: [],
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      )
    : []
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function sourcedCoordinate(...values: unknown[]): number | undefined {
  return values.find(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  )
}

export function extractSourcedMapLocation(
  propertySnapshot: unknown
): SourcedMapLocation {
  const snapshot = record(propertySnapshot)
  const property = record(snapshot.property || snapshot)
  const addressSource = property.address
  const addressRecord = record(addressSource)
  const location = record(property.location)
  const street = stringValue(
    addressRecord.street || addressRecord.address1 || addressRecord.line1
  )
  const address =
    stringValue(addressSource) ||
    stringValue(property.property_address) ||
    [
      street,
      stringValue(addressRecord.city),
      stringValue(addressRecord.state),
      stringValue(addressRecord.zip || addressRecord.postalCode),
      stringValue(addressRecord.country),
    ]
      .filter(Boolean)
      .join(', ')
  const latitude = sourcedCoordinate(
    property.latitude,
    property.property_latitude,
    location.latitude,
    location.lat,
    addressRecord.latitude,
    addressRecord.lat
  )
  const longitude = sourcedCoordinate(
    property.longitude,
    property.property_longitude,
    location.longitude,
    location.lng,
    addressRecord.longitude,
    addressRecord.lng
  )
  const validCoordinates =
    latitude !== undefined &&
    longitude !== undefined &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180

  return {
    ...(address ? { address } : {}),
    ...(validCoordinates ? { latitude, longitude } : {}),
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function assetReference(photo: Photo) {
  if (!photo.assetId || !photo.contentHash || !photo.altText) {
    throw new Error(`Photo ${photo.id} was not durably persisted`)
  }
  return {
    assetId: photo.assetId,
    url: photo.url,
    alt: photo.altText,
    contentHash: photo.contentHash,
  }
}

function photoForSection(
  section: PageSection,
  manifest: PhotoManifest
): Photo | null {
  const assignedId = section.id ? manifest.assignments[section.id] : null
  if (assignedId) {
    const assigned = manifest.photos.find((photo) => photo.id === assignedId)
    if (assigned) return assigned
  }

  if (section.acfBlock === 'acf/top-slides') {
    return manifest.byCategory.hero[0] || manifest.photos[0] || null
  }
  if (
    section.acfBlock === 'acf/feature-section' ||
    section.acfBlock === 'acf/image'
  ) {
    return (
      manifest.byCategory.amenities[0] ||
      manifest.byCategory.lifestyle[0] ||
      manifest.photos[0] ||
      null
    )
  }
  return null
}

function normalizeContent(
  section: PageSection,
  page: Pick<GeneratedPage, 'slug' | 'title' | 'purpose'>,
  manifest: PhotoManifest,
  floorPlanSnapshot: ApprovedFloorPlanSnapshot,
  pointsOfInterest: ApprovedPointOfInterest[],
  integrityContext: SiteForgeFinalizationIntegrityContext
): Record<string, unknown> {
  const raw = section.content
  const headline = stringValue(raw.headline, section.label || section.type)
  const body = stringValue(
    raw.content,
    stringValue(raw.description, section.purpose || section.reasoning)
  )
  const photo = photoForSection(section, manifest)

  switch (section.acfBlock as ACFBlockType) {
    case 'acf/menu': {
      const menuItems = records(raw.menu_items)
      return {
        menu_items: (
          menuItems.length
            ? menuItems
            : [{ label: 'Explore', link: '#main' }]
        ).map((item) => ({
          label: stringValue(item.label, 'Explore'),
          link: stringValue(item.link, '#main'),
        })),
      }
    }
    case 'acf/top-slides':
      if (!photo) throw new Error(`Section ${section.id || section.type} requires a hero asset`)
      return {
        slides: [
          {
            image: assetReference(photo),
            headline,
            subheadline: stringValue(raw.subheadline, body).slice(0, 300) || undefined,
            cta_text: stringValue(raw.cta_text, 'Schedule a tour'),
            cta_link: stringValue(raw.cta_link, '/contact'),
          },
        ],
        autoplay: true,
        overlay_style: 'gradient',
      }
    case 'acf/text-section':
      return {
        headline,
        subheading: stringValue(raw.subheading) || undefined,
        content: body,
        layout: raw.layout === 'left' ? 'left' : 'center',
        background: ['white', 'light', 'dark'].includes(String(raw.background))
          ? raw.background
          : 'white',
      }
    case 'acf/feature-section':
      if (!photo) throw new Error(`Section ${section.id || section.type} requires an image asset`)
      return {
        image: assetReference(photo),
        headline,
        content: body,
        layout: raw.layout === 'image-right' ? 'image-right' : 'image-left',
        cta_text: stringValue(raw.cta_text) || undefined,
        cta_link: stringValue(raw.cta_link) || undefined,
      }
    case 'acf/image':
      if (!photo) throw new Error(`Section ${section.id || section.type} requires an image asset`)
      return {
        image: assetReference(photo),
        size: ['full', 'large', 'medium'].includes(String(raw.size))
          ? raw.size
          : 'large',
        caption: stringValue(raw.caption, photo.altText) || undefined,
      }
    case 'acf/links': {
      const links = records(raw.links)
      return {
        links: (
          links.length
            ? links
            : [
                {
                  text: stringValue(raw.cta_text, 'Contact us'),
                  url: stringValue(raw.cta_link, '/contact'),
                  style: 'primary',
                },
              ]
        ).map((item) => ({
          text: stringValue(item.text, 'Learn more'),
          url: stringValue(item.url, '/contact'),
          style: item.style === 'secondary' ? 'secondary' : 'primary',
        })),
      }
    }
    case 'acf/content-grid': {
      const items = records(raw.items)
      return {
        items: (
          items.length
            ? items
            : [{ headline, description: body }]
        ).map((item) => ({
          headline: stringValue(item.headline, headline),
          description: stringValue(item.description, body),
          icon: stringValue(item.icon) || undefined,
        })),
        columns: ['2', '3', '4'].includes(String(raw.columns))
          ? String(raw.columns)
          : '3',
      }
    }
    case 'acf/form': {
      const requestedFormType = String(raw.form_type)
      const inferredFormType = /\b(schedule|book)?[\s-]*(a[\s-]*)?tour\b/i.test(
        [
          page.slug,
          page.title,
          page.purpose,
          section.label,
          section.type,
          raw.heading,
        ].join(' ')
      )
        ? 'tour'
        : 'contact'
      const formType = ['contact', 'tour', 'register'].includes(requestedFormType)
        ? requestedFormType
        : inferredFormType
      const provider =
        formType === 'tour'
          ? integrityContext.formProviders?.tour
          : integrityContext.formProviders?.lead
      return {
        heading: stringValue(raw.heading, headline),
        subheading: stringValue(raw.subheading, body).slice(0, 300) || undefined,
        form_type: formType,
        redirect_url: stringValue(raw.redirect_url) || undefined,
        provider: provider || 'p11_lumaleasing',
        consent_text:
          'By submitting, you agree that the property may contact you about leasing. Message and data rates may apply.',
      }
    }
    case 'acf/map': {
      const location = integrityContext.mapLocation
      const hasCoordinates =
        location?.latitude !== undefined && location.longitude !== undefined
      if (!location?.address && !hasCoordinates) {
        throw new Error(
          `Section ${section.id || section.type} requires a sourced address or coordinate pair`
        )
      }
      return {
        ...(location.address ? { address: location.address } : {}),
        ...(hasCoordinates
          ? {
              latitude: location.latitude,
              longitude: location.longitude,
            }
          : {}),
        zoom_level:
          typeof raw.zoom_level === 'number' ? Math.round(raw.zoom_level) : 15,
        show_directions: raw.show_directions !== false,
      }
    }
    case 'acf/html-section':
      return {
        html_content: `<p>${escapeHtml(body)}</p>`,
      }
    case 'acf/gallery': {
      const photos = manifest.byCategory.gallery.length
        ? manifest.byCategory.gallery
        : manifest.photos
      if (!photos.length) {
        throw new Error(`Section ${section.id || section.type} requires gallery assets`)
      }
      return {
        images: photos.slice(0, 40).map(assetReference),
        layout: raw.layout === 'masonry' ? 'masonry' : 'grid',
      }
    }
    case 'acf/accordion-section': {
      const items = records(raw.items)
      return {
        items: (
          items.length
            ? items
            : [{ title: headline, content: body }]
        ).map((item) => ({
          title: stringValue(item.title, headline),
          content: stringValue(item.content, body),
        })),
      }
    }
    case 'acf/plans-availability':
      return {
        data_source: 'siteforge',
        floor_plans: floorPlanSnapshot.rows.map((row) => ({
          id: row.id,
          name: row.name,
          bedrooms: row.bedrooms,
          bathrooms: row.bathrooms,
          sqft_min: row.sqftMin,
          sqft_max: row.sqftMax,
          rent_min: row.rentMin,
          rent_max: row.rentMax,
          available_count: row.availableCount,
          specials: row.specials,
          image_url: row.imageUrl,
          image_alt: row.imageUrl
            ? row.imageAlt || `${row.name} floor plan`
            : undefined,
          availability_url: row.availabilityUrl,
          apply_url: row.applyUrl,
          source: row.source,
          source_identity: row.sourceIdentity,
          effective_at: row.effectiveAt,
          expires_at: row.expiresAt,
          source_updated_at: row.sourceUpdatedAt,
        })),
        inventory_snapshot: {
          captured_at: floorPlanSnapshot.capturedAt,
          content_hash: floorPlanSnapshot.contentHash,
        },
        display_style: ['cards', 'interactive', 'list'].includes(
          String(raw.display_style)
        )
          ? raw.display_style
          : 'cards',
        filter_options: ['bedrooms', 'bathrooms', 'square_footage', 'price', 'availability'],
        show_pricing: raw.show_pricing !== false,
        show_availability: raw.show_availability !== false,
        freshness_hours:
          typeof raw.freshness_hours === 'number'
            ? Math.round(raw.freshness_hours)
            : 168,
      }
    case 'acf/poi':
      return {
        intro_text: body,
        points: pointsOfInterest.map((point) => ({
          name: point.name,
          category: point.category,
          address:
            typeof point.address === 'string'
              ? point.address
              : point.address &&
                  typeof point.address === 'object' &&
                  !Array.isArray(point.address)
                ? Object.values(point.address)
                    .filter((value): value is string => typeof value === 'string')
                    .join(', ')
                : undefined,
          distance_miles: point.distance_miles ?? undefined,
          travel_time_minutes: point.travel_time_minutes ?? undefined,
          source_url: point.source_url ?? undefined,
        })),
        categories: ['restaurants', 'shopping', 'entertainment', 'transit'],
        radius_miles:
          typeof raw.radius_miles === 'number'
            ? Math.round(raw.radius_miles)
            : 1,
      }
  }
}

export function finalizeSiteForgePages(
  pages: GeneratedPage[],
  manifest: PhotoManifest,
  legal: SiteForgeLegalConfig,
  floorPlanSnapshot: ApprovedFloorPlanSnapshot = EMPTY_FLOOR_PLAN_SNAPSHOT,
  pointsOfInterest: ApprovedPointOfInterest[] = [],
  integrityContext: SiteForgeFinalizationIntegrityContext = {}
): GeneratedPage[] {
  const legalSpecs = [
    {
      path: legal.privacyPath,
      title: 'Privacy',
      purpose: 'Publish the approved privacy policy.',
      id: 'privacy-policy',
      body: legal.policyBodies.privacyPolicy,
    },
    {
      path: legal.termsPath,
      title: 'Terms',
      purpose: 'Publish the approved terms of use.',
      id: 'terms-of-use',
      body: legal.policyBodies.terms,
    },
    {
      path: legal.accessibilityPath,
      title: 'Accessibility',
      purpose: 'Publish the approved accessibility statement.',
      id: 'accessibility-statement',
      body: legal.policyBodies.accessibility,
    },
  ].map(spec => ({
    ...spec,
    slug: spec.path.replace(/^\/+|\/+$/g, ''),
  }))
  const legalSlugs = new Set(legalSpecs.map(spec => spec.slug))
  const contentPages = pages.filter(page => !legalSlugs.has(page.slug))
  const legalPages: GeneratedPage[] = legalSpecs.map(spec => ({
    slug: spec.slug,
    title: spec.title,
    purpose: spec.purpose,
    sections: [
      {
        id: spec.id,
        type: 'legal',
        acfBlock: 'acf/text-section' as const,
        order: 0,
        reasoning: 'Publish the exact approved legal policy body',
        evidenceIds: [legalEvidenceId(legal)],
        content: {
          headline: spec.title,
          content: spec.body,
        },
      },
    ],
  }))

  return [...contentPages, ...legalPages].map((page) => {
    const seoDescription = `${page.purpose.trim()} Explore floor plans, amenities, neighborhood details, and ways to contact the leasing team.`
      .slice(0, 160)
      .trim()
    const normalized = {
      ...page,
      seo: {
        title: page.title.slice(0, 60),
        description:
          seoDescription.length >= 50
            ? seoDescription
            : `${seoDescription} Learn more about this apartment community.`.slice(
                0,
                160
              ),
        canonicalPath: page.slug === 'home' ? '/' : `/${page.slug}`,
        noIndex: false,
        structuredData:
          page.slug === 'home'
            ? ['WebPage', 'ApartmentComplex', 'BreadcrumbList']
            : ['WebPage', 'BreadcrumbList'],
      },
      sections: page.sections.map((section, index) => ({
        ...section,
        id: section.id || `${page.slug}-${index + 1}`,
        order: index,
        evidenceIds: section.evidenceIds || [],
        content: normalizeContent(
          section,
          page,
          manifest,
          floorPlanSnapshot,
          pointsOfInterest,
          integrityContext
        ),
      })),
    }
    return strictGeneratedPageSchema.parse(
      normalized
    ) as unknown as GeneratedPage & {
      sections: StrictSiteForgePageSection[]
    }
  })
}
