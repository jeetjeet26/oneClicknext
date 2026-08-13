import type { GeneratedPage, SiteConfiguration } from '@/types/siteforge'
import type { Json } from '@/types/supabase'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  runtimeV3OperationSchema,
  runtimeV3ResourceGraphSchema,
  type RuntimeV3Operation,
  type RuntimeV3ResourceGraph,
} from '@/utils/siteforge/runtime-contract-v3'

export interface RuntimeV3ArtifactAsset {
  id: string
  type: string
  source: string
  fileUrl: string
  storagePath: string
  byteSha256: string
  bytes?: number | null
  mimeType?: string | null
  altText?: string | null
  caption?: string | null
  width?: number | null
  height?: number | null
  approvalStatus: 'approved'
  rightsStatus: 'owned' | 'licensed' | 'generated'
}

export interface SiteForgeRuntimeV3Descriptor {
  identity: {
    extensions: []
  }
  resourceGraph: RuntimeV3ResourceGraph
  operations: RuntimeV3Operation[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function runtimeId(prefix: string, value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${prefix}:${normalized || 'resource'}`.slice(0, 240)
}

function withHash<T extends { resourceId: string }>(
  value: T
): T & { contentHash: string } {
  return {
    ...value,
    contentHash: hashSiteForgeContent(value),
  }
}

function pagePath(slug: string): string {
  return slug === 'home' ? '/' : `/${slug}/`
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(strings)
  }
  return []
}

function referencedAssetIds(
  value: unknown,
  assets: RuntimeV3ArtifactAsset[]
): string[] {
  const serialized = JSON.stringify(value)
  return assets
    .filter(
      asset =>
        serialized.includes(asset.id) || serialized.includes(asset.fileUrl)
    )
    .map(asset => asset.id)
}

function formFields(formType: string) {
  const fields = [
    {
      fieldId: 'field:name',
      type: 'text' as const,
      label: 'Name',
      required: true,
      options: [],
      autocomplete: 'name',
    },
    {
      fieldId: 'field:email',
      type: 'email' as const,
      label: 'Email',
      required: true,
      options: [],
      autocomplete: 'email',
    },
    {
      fieldId: 'field:phone',
      type: 'tel' as const,
      label: 'Phone',
      required: false,
      options: [],
      autocomplete: 'tel',
    },
  ]
  return formType === 'tour'
    ? [
        ...fields,
        {
          fieldId: 'field:tour-date',
          type: 'date' as const,
          label: 'Preferred tour date',
          required: false,
          options: [],
          autocomplete: null,
        },
      ]
    : fields
}

function compileLegal(blueprint: Record<string, unknown>) {
  const legal = record(blueprint.legal)
  const policies = record(legal.policyBodies)
  const types = [
    ['privacy', 'privacyPolicy'],
    ['terms', 'terms'],
    ['accessibility', 'accessibility'],
    ['fair_housing', 'fairHousing'],
    ['pricing_disclaimer', 'pricingDisclaimer'],
    ['analytics_consent', 'analyticsConsent'],
    ['communications_consent', 'communicationsConsent'],
  ] as const
  return types.flatMap(([policyType, key]) => {
    const body = policies[key]
    if (typeof body !== 'string' || !body.trim()) return []
    return [
      withHash({
        resourceId: runtimeId('legal', policyType),
        policyType,
        policyVersion:
          typeof legal.sourceVersion === 'number' ? legal.sourceVersion : 1,
        approvedAt:
          typeof legal.approvedAt === 'string'
            ? legal.approvedAt
            : new Date(0).toISOString(),
        effectiveAt:
          typeof legal.effectiveAt === 'string'
            ? legal.effectiveAt
            : new Date(0).toISOString(),
        body,
        approvalEvidenceHash:
          typeof legal.sourceHash === 'string'
            ? legal.sourceHash
            : hashSiteForgeContent(legal),
      }),
    ]
  })
}

export function compileSiteForgeRuntimeV3Descriptor(input: {
  blueprint: Json
  assetManifest: RuntimeV3ArtifactAsset[]
}): SiteForgeRuntimeV3Descriptor {
  const blueprint = record(input.blueprint)
  const pages = Array.isArray(blueprint.pages)
    ? (blueprint.pages as unknown as GeneratedPage[])
    : []
  if (!pages.length) {
    throw new Error('Runtime v3 compilation requires at least one page')
  }
  const siteConfiguration = record(
    blueprint.siteConfiguration
  ) as unknown as SiteConfiguration
  const pageIds = new Map(
    pages.map(page => [page.slug, runtimeId('page', page.slug)])
  )
  const formResources: RuntimeV3ResourceGraph['forms'] = []
  const integrationByProvider = new Map<
    string,
    RuntimeV3ResourceGraph['integrations'][number]
  >()
  const sectionResources: RuntimeV3ResourceGraph['sections'] = []

  for (const page of pages) {
    const pageId = pageIds.get(page.slug)!
    for (const [index, section] of page.sections.entries()) {
      const sectionId = runtimeId(
        'section',
        `${page.slug}:${section.id || `${section.type}-${index}`}`
      )
      const content = record(section.content)
      let formId: string | null = null
      const integrationIds: string[] = []
      if (section.acfBlock === 'acf/form') {
        const formType =
          typeof content.form_type === 'string' ? content.form_type : 'contact'
        const provider =
          typeof content.provider === 'string'
            ? content.provider
            : 'p11_lumaleasing'
        formId = runtimeId('form', sectionId)
        const integrationId = runtimeId('integration', provider)
        integrationIds.push(integrationId)
        const redirectPath =
          typeof content.redirect_url === 'string' &&
          content.redirect_url.startsWith('/')
            ? content.redirect_url
            : null
        formResources.push(
          withHash({
            resourceId: formId,
            formType:
              formType === 'tour'
                ? ('tour' as const)
                : formType === 'contact'
                  ? ('contact' as const)
                  : ('custom' as const),
            fields: formFields(formType),
            submitLabel: formType === 'tour' ? 'Schedule a tour' : 'Submit',
            integrationId,
            consentLegalResourceId: runtimeId(
              'legal',
              'communications_consent'
            ),
            successBehavior: {
              mode: redirectPath ? ('redirect' as const) : ('message' as const),
              message: redirectPath ? null : 'Thank you. We will be in touch.',
              redirectPath,
            },
          })
        )
        const existing = integrationByProvider.get(provider)
        if (existing) {
          existing.pageIds = [...new Set([...existing.pageIds, pageId])]
          existing.formIds = [...new Set([...existing.formIds, formId])]
          existing.contentHash = hashSiteForgeContent({
            ...existing,
            contentHash: undefined,
          })
        } else {
          integrationByProvider.set(
            provider,
            withHash({
              resourceId: integrationId,
              provider,
              scopes: ['form_submission' as const],
              pageIds: [pageId],
              formIds: [formId],
              allowedDestinations: [],
              configuration: { formType },
              secretReference: null,
            })
          )
        }
      }
      sectionResources.push(
        withHash({
          resourceId: sectionId,
          pageId,
          sectionType: runtimeId('type', section.type || section.acfBlock),
          blockName: section.acfBlock,
          order: section.order,
          variant: section.variant || null,
          anchor: section.id ? runtimeId('anchor', section.id) : null,
          cssClasses: section.cssClasses || [],
          data: content,
          assetIds: referencedAssetIds(content, input.assetManifest),
          formId,
          integrationIds,
        })
      )
    }
  }

  const seoResources = pages.map(page =>
    withHash({
      resourceId: runtimeId('seo', page.slug),
      scope: 'page' as const,
      pageId: pageIds.get(page.slug)!,
      title: page.seo?.title || page.title,
      description: page.seo?.description || page.purpose,
      canonicalPath: page.seo?.canonicalPath || pagePath(page.slug),
      robots: {
        index: !(page.seo?.noIndex ?? false),
        follow: true,
      },
      openGraph: {
        title: page.seo?.title || page.title,
        description: page.seo?.description || page.purpose,
        imageAssetId:
          page.slug === 'home' ? input.assetManifest[0]?.id || null : null,
      },
      structuredData: (page.seo?.structuredData || ['WebPage']).map(type => ({
        '@type': type,
      })),
    })
  )
  const pageResources = pages.map((page, index) =>
    withHash({
      resourceId: pageIds.get(page.slug)!,
      slug: page.slug,
      title: page.title,
      purpose: page.purpose,
      status: 'publish' as const,
      template: '',
      menuOrder: index,
      sectionIds: sectionResources
        .filter(section => section.pageId === pageIds.get(page.slug))
        .map(section => section.resourceId),
      seoId: runtimeId('seo', page.slug),
    })
  )
  const header = withHash({
    resourceId: 'component:header',
    componentType: 'header' as const,
    data: record(siteConfiguration?.header),
    assetIds: [],
    integrationIds: [],
  })
  const footer = withHash({
    resourceId: 'component:footer',
    componentType: 'footer' as const,
    data: record(siteConfiguration?.footer),
    assetIds: [],
    integrationIds: [],
  })
  const navigation = withHash({
    resourceId: 'component:navigation',
    componentType: 'navigation' as const,
    data: record(siteConfiguration?.navigation),
    assetIds: [],
    integrationIds: [],
  })
  const chrome = withHash({
    resourceId: 'chrome:primary',
    headerComponentId: header.resourceId,
    footerComponentId: footer.resourceId,
    componentIds: [
      header.resourceId,
      footer.resourceId,
      navigation.resourceId,
    ],
  })
  const legal = compileLegal(blueprint)
  if (!legal.length) {
    throw new Error('Runtime v3 compilation requires approved legal resources')
  }
  const analyticsConfig = record(blueprint.analytics)
  const analytics = withHash({
    resourceId: 'analytics:site',
    consentMode:
      analyticsConfig.consentMode === 'optional' ||
      analyticsConfig.consentMode === 'disabled'
        ? analyticsConfig.consentMode
        : ('required' as const),
    integrationIds: [],
    events: (Array.isArray(analyticsConfig.events)
      ? analyticsConfig.events
      : []
    ).flatMap((event, index) =>
      typeof event === 'string'
        ? [
            {
              eventId: runtimeId('event', `${event}-${index}`),
              name: runtimeId('event-name', event),
              trigger: event,
              parameters: { source: 'siteforge' },
            },
          ]
        : []
    ),
  })
  const graphAssets = input.assetManifest.map(asset => {
    if (!asset.bytes || !asset.mimeType) {
      throw new Error(
        `Runtime v3 asset ${asset.id} requires byte size and MIME type`
      )
    }
    const filename =
      asset.storagePath.split('/').pop()?.split('?')[0] || `${asset.id}.bin`
    return withHash({
      resourceId: runtimeId('asset', asset.id),
      assetId: asset.id,
      byteSha256: asset.byteSha256,
      bytes: asset.bytes,
      mimeType: asset.mimeType,
      filename,
      role: asset.type,
      altText: asset.altText || null,
      caption: asset.caption || null,
      width: asset.width || null,
      height: asset.height || null,
      rights: {
        status: asset.rightsStatus,
        evidenceHash: hashSiteForgeContent({
          id: asset.id,
          approvalStatus: asset.approvalStatus,
          rightsStatus: asset.rightsStatus,
        }),
      },
    })
  })
  const responsiveRules = [
    withHash({
      resourceId: 'responsive:site',
      target: {
        resourceKind: 'chrome' as const,
        resourceId: chrome.resourceId,
      },
      minWidthPx: null,
      maxWidthPx: 767,
      declarations: {
        padding: '1rem',
      },
    }),
  ]
  const accessibilityAnnotations = sectionResources.map((section, index) =>
    withHash({
      resourceId: runtimeId('a11y', section.resourceId),
      target: {
        resourceKind: 'section' as const,
        resourceId: section.resourceId,
      },
      standard: 'WCAG-2.2-AA' as const,
      role: 'region',
      accessibleName:
        strings(section.data).find(value => value.trim().length > 0)?.slice(
          0,
          1_000
        ) || null,
      description: null,
      keyboardBehavior: section.formId ? ['Tab', 'Shift+Tab', 'Enter'] : [],
      headingLevel: index === 0 ? 1 : 2,
      liveRegion: 'off' as const,
    })
  )
  const redirects = (
    Array.isArray(blueprint.runtimeRedirects)
      ? blueprint.runtimeRedirects
      : []
  ).flatMap((value, index) => {
    const redirect = record(value)
    if (
      typeof redirect.sourcePath !== 'string' ||
      typeof redirect.destination !== 'string'
    ) {
      return []
    }
    return [
      withHash({
        resourceId: runtimeId('redirect', `${index}-${redirect.sourcePath}`),
        sourcePath: redirect.sourcePath,
        destination: redirect.destination,
        statusCode:
          redirect.statusCode === 302 ||
          redirect.statusCode === 307 ||
          redirect.statusCode === 308
            ? redirect.statusCode
            : (301 as const),
        preserveQuery: redirect.preserveQuery !== false,
      }),
    ]
  })
  const resourceGraph = runtimeV3ResourceGraphSchema.parse({
    graphVersion: 1,
    homepagePageId: pageIds.get('home') || pageResources[0].resourceId,
    pages: pageResources,
    sections: sectionResources,
    globalComponents: [header, footer, navigation],
    chrome,
    forms: formResources,
    redirects,
    responsiveRules,
    accessibilityAnnotations,
    seo: seoResources,
    legal,
    analytics,
    integrations: [...integrationByProvider.values()],
    assets: graphAssets,
    removals: [],
  })
  const operations = [
    runtimeV3OperationSchema.parse({
      operationId: 'operation:configure-release',
      sequence: 0,
      kind: 'configure',
      resourceKind: 'chrome',
      resourceId: chrome.resourceId,
      resourceHash: chrome.contentHash,
      payloadHash: hashSiteForgeContent(resourceGraph),
      dependsOn: [],
    }),
  ]
  return {
    identity: { extensions: [] },
    resourceGraph,
    operations,
  }
}
