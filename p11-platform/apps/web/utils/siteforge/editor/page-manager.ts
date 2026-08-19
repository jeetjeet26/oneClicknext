import { z } from 'zod'
import {
  blueprintPatchOperationsSchema,
  type BlueprintPatchOperation,
  type GeneratedPage,
  type SiteBlueprint,
  type SiteConfiguration,
} from '@/types/siteforge'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

const seoInputSchema = z
  .object({
    title: z.string().trim().min(1).max(60).optional(),
    description: z.string().trim().min(50).max(160).optional(),
    noIndex: z.boolean().optional(),
  })
  .strict()

const navigationInputSchema = z
  .object({
    visible: z.boolean().optional(),
    label: z.string().trim().min(1).max(80).optional(),
    order: z.number().int().min(1).optional(),
  })
  .strict()

const pageManagerUpdateSchema = z
  .object({
    type: z.literal('update'),
    pageSlug: slugSchema,
    slug: slugSchema.optional(),
    title: z.string().trim().min(1).max(160).optional(),
    purpose: z.string().trim().min(1).max(1_000).optional(),
    seo: seoInputSchema.optional(),
    navigation: navigationInputSchema.optional(),
  })
  .strict()
  .refine(
    action =>
      action.slug !== undefined ||
      action.title !== undefined ||
      action.purpose !== undefined ||
      action.seo !== undefined ||
      action.navigation !== undefined,
    { message: 'Page update requires at least one structured field' }
  )

export const siteForgePageManagerActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('add'),
      visitorIntent: z.string().trim().min(10).max(2_000),
      slug: slugSchema,
      title: z.string().trim().min(1).max(160),
      purpose: z.string().trim().min(10).max(1_000),
      seo: seoInputSchema.optional(),
      navigation: navigationInputSchema.optional(),
    })
    .strict(),
  pageManagerUpdateSchema,
  z
    .object({
      type: z.literal('move'),
      pageSlug: slugSchema,
      toOrder: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('remove'),
      pageSlug: slugSchema,
      redirectToSlug: slugSchema,
    })
    .strict(),
])

export type SiteForgePageManagerAction = z.infer<
  typeof siteForgePageManagerActionSchema
>

export function pageManagerActionEvidenceId(
  action: SiteForgePageManagerAction
): string {
  return `operator-page-intent:${hashSiteForgeContent(action)}`
}

type NavigationItem = SiteConfiguration['navigation']['items'][number]

function pagePath(slug: string): string {
  return slug === 'home' ? '/' : `/${slug}/`
}

function escapedCopy(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function seoDescription(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const expanded =
    normalized.length >= 50
      ? normalized
      : `${normalized} Explore this page for clear information and next steps.`
  return expanded.slice(0, 160).replace(/\s+\S*$/, '').padEnd(50, '.')
}

function pageSeo(input: {
  slug: string
  title: string
  purpose: string
  current?: GeneratedPage['seo']
  update?: z.infer<typeof seoInputSchema>
}): NonNullable<GeneratedPage['seo']> {
  const title = input.update?.title || input.current?.title || input.title
  return {
    title: title.slice(0, 60),
    description:
      input.update?.description ||
      input.current?.description ||
      seoDescription(input.purpose),
    canonicalPath: pagePath(input.slug),
    noIndex:
      input.update?.noIndex ?? input.current?.noIndex ?? false,
    structuredData: input.current?.structuredData?.includes('WebPage')
      ? input.current.structuredData
      : ['WebPage', 'BreadcrumbList'],
  }
}

function composeGovernedPage(
  action: Extract<SiteForgePageManagerAction, { type: 'add' }>
): GeneratedPage {
  const purpose = escapedCopy(action.purpose)
  const visitorIntent = escapedCopy(action.visitorIntent)
  const evidenceId = pageManagerActionEvidenceId(action)
  return {
    slug: action.slug,
    title: action.title,
    purpose: action.purpose,
    priority: 'managed',
    seo: pageSeo({
      slug: action.slug,
      title: action.title,
      purpose: action.purpose,
      update: action.seo,
    }),
    sections: [
      {
        id: `page-${action.slug}-overview`,
        type: 'visitor-intent-overview',
        acfBlock: 'acf/text-section',
        order: 1,
        label: `${action.title} overview`,
        variant: 'lead',
        purpose: action.purpose,
        reasoning:
          'Deterministic page-manager composition introduces the operator-approved visitor goal.',
        evidenceIds: [evidenceId],
        content: {
          headline: action.title,
          subheading: purpose,
          content: purpose,
          layout: 'center',
          background: 'white',
        },
      },
      {
        id: `page-${action.slug}-next-steps`,
        type: 'visitor-intent-next-steps',
        acfBlock: 'acf/text-section',
        order: 2,
        label: `${action.title} next steps`,
        variant: 'contained',
        purpose: action.visitorIntent,
        reasoning:
          'Deterministic governed composition preserves the explicit visitor intent without inventing property facts.',
        evidenceIds: [evidenceId],
        content: {
          headline: 'What you can do here',
          content: visitorIntent,
          layout: 'left',
          background: 'light',
        },
      },
    ],
  }
}

function requiredLegalSlugs(blueprint: SiteBlueprint): Set<string> {
  const record = blueprint as unknown as Record<string, unknown>
  const legal =
    record.legal && typeof record.legal === 'object' && !Array.isArray(record.legal)
      ? (record.legal as Record<string, unknown>)
      : {}
  const configured = [
    legal.privacyPath,
    legal.termsPath,
    legal.accessibilityPath,
  ].flatMap(path =>
    typeof path === 'string'
      ? path.replace(/^\/+|\/+$/g, '')
      : []
  )
  const conventional = ['privacy', 'terms', 'accessibility'].filter(slug =>
    blueprint.pages.some(page => page.slug === slug)
  )
  return new Set([...configured, ...conventional])
}

export function inspectSiteForgeManagedPages(blueprint: SiteBlueprint) {
  const legalSlugs = requiredLegalSlugs(blueprint)
  const navigationItems = blueprint.siteConfiguration?.navigation.items || []
  return blueprint.pages.map((page, index) => {
    const path = pagePath(page.slug)
    const navigation = navigationItems.find(
      item => item.href === path || item.id === page.slug
    )
    return {
      ...page,
      order: index + 1,
      required: page.slug === 'home' || legalSlugs.has(page.slug),
      legal: legalSlugs.has(page.slug),
      navigation: navigation
        ? {
            visible: true,
            label: navigation.label,
            order: navigationItems.indexOf(navigation) + 1,
          }
        : { visible: false, label: page.title, order: null },
    }
  })
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function moveItem<T>(items: T[], from: number, toOrder: number): T[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item === undefined) return next
  next.splice(Math.min(toOrder - 1, next.length), 0, item)
  return next
}

function managedNavigation(
  blueprint: SiteBlueprint,
  input: {
    oldSlug?: string
    slug: string
    title: string
    navigation?: z.infer<typeof navigationInputSchema>
    remove?: boolean
  }
): NavigationItem[] {
  const current = [...(blueprint.siteConfiguration?.navigation.items || [])]
  const oldPath = input.oldSlug ? pagePath(input.oldSlug) : null
  const index = current.findIndex(
    item =>
      item.id === input.oldSlug ||
      item.id === input.slug ||
      item.href === oldPath ||
      item.href === pagePath(input.slug)
  )
  const visible = input.remove
    ? false
    : input.navigation?.visible ?? index >= 0
  if (!visible) {
    return index >= 0
      ? current.filter((_, itemIndex) => itemIndex !== index)
      : current
  }
  const existing = index >= 0 ? current[index] : undefined
  const item: NavigationItem = {
    ...(existing || {}),
    id: input.slug,
    label: input.navigation?.label || existing?.label || input.title,
    href: pagePath(input.slug),
  }
  let next =
    index >= 0
      ? current.map((candidate, itemIndex) =>
          itemIndex === index ? item : candidate
        )
      : [...current, item]
  if (input.navigation?.order) {
    next = moveItem(
      next,
      next.findIndex(candidate => candidate.id === input.slug),
      input.navigation.order
    )
  }
  return next
}

function rewritePath(value: unknown, source: string, destination: string): unknown {
  if (typeof value === 'string') {
    const sourceWithoutSlash = source === '/' ? source : source.replace(/\/$/, '')
    return value === source || value === sourceWithoutSlash ? destination : value
  }
  if (Array.isArray(value)) {
    return value.map(item => rewritePath(item, source, destination))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rewritePath(item, source, destination),
      ])
    )
  }
  return value
}

function linkedContentOperations(
  blueprint: SiteBlueprint,
  sourceSlug: string,
  destinationSlug: string,
  excludedSlug?: string
): BlueprintPatchOperation[] {
  const source = pagePath(sourceSlug)
  const destination = pagePath(destinationSlug)
  return blueprint.pages.flatMap(page =>
    page.slug === excludedSlug
      ? []
      : page.sections.flatMap(section => {
          if (!section.id) return []
          const content = rewritePath(
            section.content,
            source,
            destination
          ) as Record<string, unknown>
          return sameValue(content, section.content)
            ? []
            : [
                {
                  version: 2 as const,
                  op: 'section.update' as const,
                  sectionId: section.id,
                  value: { content },
                  reasoning:
                    'Rebound an internal page link to the declared redirect destination.',
                },
              ]
        })
  )
}

function configurationLinkOperations(
  blueprint: SiteBlueprint,
  sourceSlug: string,
  destinationSlug: string
): BlueprintPatchOperation[] {
  const header = blueprint.siteConfiguration?.header
  if (!header) return []
  const source = pagePath(sourceSlug)
  const destination = pagePath(destinationSlug)
  const value: Record<string, unknown> = {}
  if (
    header.cta.href === source ||
    header.cta.href === source.replace(/\/$/, '')
  ) {
    value.cta = { ...header.cta, href: destination }
  }
  if (
    header.announcement.link === source ||
    header.announcement.link === source.replace(/\/$/, '')
  ) {
    value.announcement = { ...header.announcement, link: destination }
  }
  return Object.keys(value).length
    ? [
        {
          version: 2,
          op: 'header.update',
          value,
          reasoning:
            'Rebound global links to the declared page redirect destination.',
        } as BlueprintPatchOperation,
      ]
    : []
}

function redirectOperations(
  blueprint: SiteBlueprint,
  sourceSlug: string,
  destinationSlug: string
): BlueprintPatchOperation[] {
  const sourcePath = pagePath(sourceSlug)
  const destination = pagePath(destinationSlug)
  const inbound = (blueprint.runtimeRedirects || []).filter(
    redirect =>
      redirect.destination === sourcePath ||
      redirect.destination === sourcePath.replace(/\/$/, '')
  )
  return [
    ...inbound.map(redirect => ({
      version: 2 as const,
      op: 'redirect.upsert' as const,
      redirect: { ...redirect, destination },
      reasoning: 'Collapsed an inbound redirect to avoid a redirect chain.',
    })),
    {
      version: 2,
      op: 'redirect.upsert',
      redirect: {
        sourcePath,
        destination,
        statusCode: 301,
        preserveQuery: true,
      },
      reasoning: 'Preserve the removed public URL with a permanent redirect.',
    } as const,
  ]
}

function navigationOperation(
  before: NavigationItem[],
  after: NavigationItem[]
): BlueprintPatchOperation[] {
  return sameValue(before, after)
    ? []
    : [
        {
          version: 2,
          op: 'navigation.update',
          value: { items: after },
          reasoning:
            'Keep public navigation synchronized with the managed page set.',
        },
      ]
}

export function pageManagerActionSummary(
  action: SiteForgePageManagerAction
): string {
  if (action.type === 'add') {
    return `Add /${action.slug} for visitor intent: ${action.visitorIntent}`
  }
  if (action.type === 'move') {
    return `Move /${action.pageSlug} to page position ${action.toOrder}`
  }
  if (action.type === 'remove') {
    return `Remove /${action.pageSlug} and redirect it to /${action.redirectToSlug}`
  }
  return `Update managed page /${action.pageSlug}`
}

export function planSiteForgePageManagerAction(input: {
  blueprint: SiteBlueprint
  action: SiteForgePageManagerAction
}): {
  response: string
  model: string
  operations: BlueprintPatchOperation[]
  extensionRequest: null
  clarification: null
  toolSummary: Array<{ tool: string; detail: string }>
} {
  const action = siteForgePageManagerActionSchema.parse(input.action)
  const blueprint = input.blueprint
  const currentNavigation =
    blueprint.siteConfiguration?.navigation.items || []
  const page = 'pageSlug' in action
    ? blueprint.pages.find(candidate => candidate.slug === action.pageSlug)
    : undefined
  if ('pageSlug' in action && !page) {
    throw new Error(`Managed page "${action.pageSlug}" no longer exists`)
  }
  const legalSlugs = requiredLegalSlugs(blueprint)
  const operations: BlueprintPatchOperation[] = []

  if (action.type === 'add') {
    if (blueprint.pages.some(candidate => candidate.slug === action.slug)) {
      throw new Error(`A page already uses the slug "${action.slug}"`)
    }
    const createdPage = composeGovernedPage(action)
    operations.push({
      version: 2,
      op: 'page.upsert',
      page: createdPage,
      reasoning:
        'Create a structured page from explicit visitor intent using governed blocks.',
    })
    const navigation = managedNavigation(blueprint, {
      slug: action.slug,
      title: action.title,
      navigation: {
        visible: action.navigation?.visible ?? true,
        label: action.navigation?.label,
        order: action.navigation?.order,
      },
    })
    operations.push(...navigationOperation(currentNavigation, navigation))
  } else if (action.type === 'update') {
    const currentPage = page!
    const nextSlug = action.slug || currentPage.slug
    if (
      nextSlug !== currentPage.slug &&
      blueprint.pages.some(candidate => candidate.slug === nextSlug)
    ) {
      throw new Error(`A page already uses the slug "${nextSlug}"`)
    }
    if (
      legalSlugs.has(currentPage.slug) &&
      (action.slug ||
        action.title ||
        action.purpose ||
        action.seo)
    ) {
      throw new Error('Required legal page content and identity are locked')
    }
    if (currentPage.slug === 'home' && nextSlug !== 'home') {
      throw new Error('The home page slug is required and cannot be changed')
    }
    const nextTitle = action.title || currentPage.title
    if (nextSlug !== currentPage.slug) {
      const renamedPage: GeneratedPage = {
        ...currentPage,
        slug: nextSlug,
        title: nextTitle,
        purpose: action.purpose || currentPage.purpose,
        seo: pageSeo({
          slug: nextSlug,
          title: nextTitle,
          purpose: action.purpose || currentPage.purpose,
          current: currentPage.seo,
          update: action.seo,
        }),
      }
      const originalOrder =
        blueprint.pages.findIndex(candidate => candidate.slug === currentPage.slug) +
        1
      operations.push(
        {
          version: 2,
          op: 'page.upsert',
          page: renamedPage,
          reasoning: 'Create the renamed page identity before retiring its old URL.',
        },
        {
          version: 2,
          op: 'page.remove',
          pageSlug: currentPage.slug,
          reasoning: 'Retire the old page identity after its replacement exists.',
        },
        {
          version: 2,
          op: 'page.move',
          pageSlug: nextSlug,
          toOrder: originalOrder,
          reasoning: 'Preserve deterministic page order across the slug change.',
        },
        ...linkedContentOperations(
          blueprint,
          currentPage.slug,
          nextSlug,
          currentPage.slug
        ),
        ...configurationLinkOperations(
          blueprint,
          currentPage.slug,
          nextSlug
        ),
        ...redirectOperations(blueprint, currentPage.slug, nextSlug)
      )
    } else {
      const value = {
        ...(action.title ? { title: action.title } : {}),
        ...(action.purpose ? { purpose: action.purpose } : {}),
        ...(action.seo
          ? {
              seo: pageSeo({
                slug: currentPage.slug,
                title: nextTitle,
                purpose: action.purpose || currentPage.purpose,
                current: currentPage.seo,
                update: action.seo,
              }),
            }
          : {}),
      }
      if (Object.keys(value).length) {
        operations.push({
          version: 2,
          op: 'page.update',
          pageSlug: currentPage.slug,
          value,
          reasoning: 'Apply validated managed page metadata.',
        })
      }
    }
    const navigation = managedNavigation(blueprint, {
      oldSlug: currentPage.slug,
      slug: nextSlug,
      title: nextTitle,
      navigation: action.navigation,
    })
    operations.push(...navigationOperation(currentNavigation, navigation))
  } else if (action.type === 'move') {
    if (action.toOrder > blueprint.pages.length) {
      throw new Error('Page order is outside the current page set')
    }
    operations.push({
      version: 2,
      op: 'page.move',
      pageSlug: action.pageSlug,
      toOrder: action.toOrder,
      reasoning: 'Apply the exact operator-selected page position.',
    })
    const navigationIndex = currentNavigation.findIndex(
      item =>
        item.id === action.pageSlug || item.href === pagePath(action.pageSlug)
    )
    if (navigationIndex >= 0) {
      const movedNavigation = moveItem(
        currentNavigation,
        navigationIndex,
        action.toOrder
      )
      operations.push(
        ...navigationOperation(currentNavigation, movedNavigation)
      )
    }
  } else {
    if (action.pageSlug === 'home' || legalSlugs.has(action.pageSlug)) {
      throw new Error('Home and required legal pages cannot be removed')
    }
    if (action.redirectToSlug === action.pageSlug) {
      throw new Error('Removed pages must redirect to a different page')
    }
    const destination = blueprint.pages.find(
      candidate => candidate.slug === action.redirectToSlug
    )
    if (!destination) {
      throw new Error('Redirect destination must be an existing page')
    }
    operations.push(
      {
        version: 2,
        op: 'page.remove',
        pageSlug: action.pageSlug,
        reasoning: 'Remove the explicitly selected non-required page.',
      },
      ...linkedContentOperations(
        blueprint,
        action.pageSlug,
        action.redirectToSlug,
        action.pageSlug
      ),
      ...configurationLinkOperations(
        blueprint,
        action.pageSlug,
        action.redirectToSlug
      )
    )
    const navigation = managedNavigation(blueprint, {
      oldSlug: action.pageSlug,
      slug: action.pageSlug,
      title: page!.title,
      remove: true,
    })
    operations.push(...navigationOperation(currentNavigation, navigation))
    operations.push(
      ...redirectOperations(
        blueprint,
        action.pageSlug,
        action.redirectToSlug
      )
    )
  }

  const validated = blueprintPatchOperationsSchema.parse(operations)
  return {
    response:
      action.type === 'add'
        ? `Added ${action.title} as a governed page at /${action.slug}.`
        : action.type === 'remove'
          ? `Removed /${action.pageSlug} with a permanent redirect to /${action.redirectToSlug}.`
          : action.type === 'move'
            ? `Moved /${action.pageSlug} to position ${action.toOrder}.`
            : `Updated /${action.pageSlug} through structured page operations.`,
    model: 'siteforge-deterministic-page-manager-v1',
    operations: validated,
    extensionRequest: null,
    clarification: null,
    toolSummary: [
      {
        tool: 'inspectSite',
        detail: `Inspected ${blueprint.pages.length} immutable pages`,
      },
      {
        tool: 'applySemanticOperations',
        detail: `Validated ${validated.length} structured page operations`,
      },
    ],
  }
}
