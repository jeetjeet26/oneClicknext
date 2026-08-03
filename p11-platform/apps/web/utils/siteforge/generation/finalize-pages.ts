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
  manifest: PhotoManifest,
  floorPlanSnapshot: ApprovedFloorPlanSnapshot
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
    case 'acf/form':
      return {
        heading: stringValue(raw.heading, headline),
        subheading: stringValue(raw.subheading, body).slice(0, 300) || undefined,
        form_type: ['contact', 'tour', 'register'].includes(String(raw.form_type))
          ? raw.form_type
          : 'contact',
        redirect_url: stringValue(raw.redirect_url) || undefined,
        provider: 'p11_lumaleasing',
        consent_text:
          'By submitting, you agree that the property may contact you about leasing. Message and data rates may apply.',
      }
    case 'acf/map':
      return {
        zoom_level:
          typeof raw.zoom_level === 'number' ? Math.round(raw.zoom_level) : 15,
        show_directions: raw.show_directions !== false,
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
  floorPlanSnapshot: ApprovedFloorPlanSnapshot = EMPTY_FLOOR_PLAN_SNAPSHOT
): GeneratedPage[] {
  const legalPages: GeneratedPage[] = [
    {
      slug: 'privacy',
      title: 'Privacy',
      purpose:
        'Explain how leasing inquiries and website interactions are handled.',
      sections: [
        {
          id: 'privacy-policy',
          type: 'legal',
          acfBlock: 'acf/text-section' as const,
          order: 0,
          reasoning: 'Provide a stable privacy-policy destination',
          evidenceIds: ['siteforge-legal-policy-v1'],
          content: {
            headline: 'Privacy',
            content:
              'Information submitted through this website is used to respond to leasing inquiries, schedule requested tours, operate the website, and meet applicable legal obligations. Contact the property team to ask about access, correction, or deletion of submitted information.',
          },
        },
      ],
    },
    {
      slug: 'terms',
      title: 'Terms',
      purpose: 'State the terms governing use of property website information.',
      sections: [
        {
          id: 'terms-of-use',
          type: 'legal',
          acfBlock: 'acf/text-section' as const,
          order: 0,
          reasoning: 'Provide a stable terms destination',
          evidenceIds: ['siteforge-legal-policy-v1'],
          content: {
            headline: 'Terms of Use',
            content:
              'Website content is provided for general leasing information and may change. Pricing, availability, dimensions, and features must be confirmed with the property team before relying on them.',
          },
        },
      ],
    },
    {
      slug: 'accessibility',
      title: 'Accessibility',
      purpose: 'Describe the commitment and contact path for accessible service.',
      sections: [
        {
          id: 'accessibility-statement',
          type: 'legal',
          acfBlock: 'acf/text-section' as const,
          order: 0,
          reasoning: 'Provide a stable accessibility destination',
          evidenceIds: ['siteforge-accessibility-policy-v1'],
          content: {
            headline: 'Accessibility',
            content:
              'We aim to provide an accessible website experience. If you encounter a barrier or need leasing information in another format, contact the property team for assistance.',
          },
        },
      ],
    },
  ].filter((legalPage) => !pages.some((page) => page.slug === legalPage.slug))

  return [...pages, ...legalPages].map((page) => {
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
        content: normalizeContent(section, manifest, floorPlanSnapshot),
      })),
    }
    return strictGeneratedPageSchema.parse(
      normalized
    ) as unknown as GeneratedPage & {
      sections: StrictSiteForgePageSection[]
    }
  })
}
