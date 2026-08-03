import { z } from 'zod'
import type { GeneratedPage } from '@/types/siteforge'

const safeLinkSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine(
    (value) =>
      value.startsWith('/') ||
      value.startsWith('#') ||
      value.startsWith('tel:') ||
      value.startsWith('mailto:') ||
      z.string().url().safeParse(value).success,
    'Expected a relative path, anchor, phone, email, or absolute URL'
  )

export const siteForgeAssetReferenceSchema = z
  .object({
    assetId: z.string().uuid().optional(),
    url: z.string().url(),
    alt: z.string().trim().min(1).max(500),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    mimeType: z.string().regex(/^(image|video)\//).optional(),
    contentHash: z.string().min(32).max(128).optional(),
    wpMediaId: z.number().int().positive().optional(),
  })
  .strict()

export const siteForgeBlockContentSchemas = {
  'acf/menu': z
    .object({
      menu_items: z
        .array(
          z
            .object({
              label: z.string().trim().min(1).max(80),
              link: safeLinkSchema,
            })
            .strict()
        )
        .min(1)
        .max(12),
    })
    .strict(),
  'acf/top-slides': z
    .object({
      slides: z
        .array(
          z
            .object({
              image: siteForgeAssetReferenceSchema,
              headline: z.string().trim().min(1).max(140),
              subheadline: z.string().trim().max(300).optional(),
              cta_text: z.string().trim().min(1).max(80).optional(),
              cta_link: safeLinkSchema.optional(),
            })
            .strict()
        )
        .min(1)
        .max(5),
      autoplay: z.boolean().default(true),
      overlay_style: z.enum(['gradient', 'light', 'dark']).default('gradient'),
    })
    .strict(),
  'acf/text-section': z
    .object({
      headline: z.string().trim().min(1).max(160),
      subheading: z.string().trim().max(300).optional(),
      content: z.string().trim().min(1).max(12_000),
      layout: z.enum(['center', 'left']).default('center'),
      background: z.enum(['white', 'light', 'dark']).default('white'),
    })
    .strict(),
  'acf/feature-section': z
    .object({
      image: siteForgeAssetReferenceSchema,
      headline: z.string().trim().min(1).max(160),
      content: z.string().trim().min(1).max(8_000),
      layout: z.enum(['image-left', 'image-right']).default('image-left'),
      cta_text: z.string().trim().min(1).max(80).optional(),
      cta_link: safeLinkSchema.optional(),
    })
    .strict(),
  'acf/image': z
    .object({
      image: siteForgeAssetReferenceSchema,
      size: z.enum(['full', 'large', 'medium']).default('large'),
      caption: z.string().trim().max(500).optional(),
    })
    .strict(),
  'acf/links': z
    .object({
      links: z
        .array(
          z
            .object({
              text: z.string().trim().min(1).max(80),
              url: safeLinkSchema,
              style: z.enum(['primary', 'secondary']).default('primary'),
            })
            .strict()
        )
        .min(1)
        .max(8),
    })
    .strict(),
  'acf/content-grid': z
    .object({
      items: z
        .array(
          z
            .object({
              image: siteForgeAssetReferenceSchema.optional(),
              icon: z.string().trim().max(120).optional(),
              headline: z.string().trim().min(1).max(140),
              description: z.string().trim().min(1).max(1_200),
            })
            .strict()
        )
        .min(1)
        .max(12),
      columns: z.enum(['2', '3', '4']).default('3'),
    })
    .strict(),
  'acf/form': z
    .object({
      heading: z.string().trim().min(1).max(160),
      subheading: z.string().trim().max(300).optional(),
      form_type: z.enum(['contact', 'tour', 'register']),
      redirect_url: safeLinkSchema.optional(),
      provider: z.enum(['p11_lumaleasing', 'csv_export', 'unconfigured']),
      consent_text: z.string().trim().min(1).max(1_000),
    })
    .strict(),
  'acf/map': z
    .object({
      zoom_level: z.number().int().min(1).max(21).default(15),
      show_directions: z.boolean().default(true),
    })
    .strict(),
  'acf/html-section': z
    .object({
      html_content: z
        .string()
        .trim()
        .max(20_000)
        .refine(
          (value) => !/<\s*(script|iframe|object|embed)\b/i.test(value),
          'Executable and embedded HTML is not allowed'
        ),
    })
    .strict(),
  'acf/gallery': z
    .object({
      images: z.array(siteForgeAssetReferenceSchema).min(1).max(40),
      layout: z.enum(['grid', 'masonry']).default('grid'),
    })
    .strict(),
  'acf/accordion-section': z
    .object({
      items: z
        .array(
          z
            .object({
              title: z.string().trim().min(1).max(200),
              content: z.string().trim().min(1).max(8_000),
            })
            .strict()
        )
        .min(1)
        .max(30),
    })
    .strict(),
  'acf/plans-availability': z
    .object({
      data_source: z.enum(['siteforge', 'manual', 'yardi', 'rentcafe']),
      floor_plans: z
        .array(
          z
            .object({
              id: z.string().trim().min(1).max(200),
              name: z.string().trim().min(1).max(200),
              bedrooms: z.number().int().min(0).max(20),
              bathrooms: z.number().min(0).max(20).optional(),
              sqft_min: z.number().nonnegative().optional(),
              sqft_max: z.number().nonnegative().optional(),
              rent_min: z.number().nonnegative().optional(),
              rent_max: z.number().nonnegative().optional(),
              available_count: z.number().int().nonnegative().optional(),
              specials: z.string().trim().max(2_000).optional(),
              image_url: z.string().url().optional(),
              image_alt: z.string().trim().min(1).max(500).optional(),
              availability_url: safeLinkSchema.optional(),
              apply_url: safeLinkSchema.optional(),
            })
            .strict()
        )
        .max(500)
        .optional(),
      inventory_snapshot: z
        .object({
          captured_at: z.string().datetime(),
          content_hash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .optional(),
      display_style: z.enum(['cards', 'interactive', 'list']),
      filter_options: z
        .array(z.enum(['bedrooms', 'bathrooms', 'square_footage', 'price', 'availability']))
        .max(5),
      show_pricing: z.boolean(),
      show_availability: z.boolean(),
      freshness_hours: z.number().int().positive().max(8_760),
    })
    .strict(),
  'acf/poi': z
    .object({
      intro_text: z.string().trim().max(2_000).optional(),
      categories: z
        .array(z.enum(['restaurants', 'shopping', 'entertainment', 'transit']))
        .min(1)
        .max(4),
      radius_miles: z.number().int().min(1).max(10).default(1),
    })
    .strict(),
} as const

const sectionBaseSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.string().min(1).max(120),
  reasoning: z.string().min(1).max(2_000),
  order: z.number().int().nonnegative(),
  label: z.string().min(1).max(160).optional(),
  variant: z.string().min(1).max(120).optional(),
  cssClasses: z.array(z.string().max(120)).max(20).optional(),
  purpose: z.string().min(1).max(1_000).optional(),
  evidenceIds: z.array(z.string().min(1)).default([]),
})

const strictSectionSchemas = Object.entries(siteForgeBlockContentSchemas).map(
  ([acfBlock, content]) =>
    sectionBaseSchema.extend({
      acfBlock: z.literal(acfBlock),
      content,
    })
)

export const strictSiteForgePageSectionSchema = z.discriminatedUnion(
  'acfBlock',
  strictSectionSchemas as [
    (typeof strictSectionSchemas)[number],
    (typeof strictSectionSchemas)[number],
    ...(typeof strictSectionSchemas)[number][],
  ]
)

export const strictGeneratedPageSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1).max(160),
    purpose: z.string().trim().min(1).max(1_000),
    sections: z.array(strictSiteForgePageSectionSchema).min(1).max(40),
    priority: z.string().max(80).optional(),
    seo: z
      .object({
        title: z.string().trim().min(1).max(60),
        description: z.string().trim().min(50).max(160),
        canonicalPath: safeLinkSchema,
        noIndex: z.boolean(),
        structuredData: z.array(
          z.enum(['WebPage', 'ApartmentComplex', 'BreadcrumbList', 'FAQPage'])
        ),
      })
      .strict(),
  })
  .strict()

export function normalizeLegacyBlockContent(
  pages: GeneratedPage[]
): GeneratedPage[] {
  return pages.map(page => ({
    ...page,
    sections: page.sections.map(section => ({
      ...section,
      content: siteForgeBlockContentSchemas[section.acfBlock]
        .strip()
        .parse(section.content),
    })),
  }))
}

export type StrictSiteForgePageSection = z.infer<
  typeof strictSiteForgePageSectionSchema
>
