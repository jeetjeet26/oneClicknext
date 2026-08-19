import { z } from 'zod'
import {
  siteBlueprintSchema,
  type GeneratedPage,
  type PageSection,
} from '@/types/siteforge'
import {
  applyBlockFieldAliases,
  flattenAcfRepeaterFields,
} from '@/utils/siteforge/wordpress-client'
import {
  SITEFORGE_RUNTIME_CONTRACT_VERSION,
  assetPreparationRequestSchema,
  assetPreparationResultSchema,
  compiledMutationPlanSchema,
  deploymentSubmissionSchema,
  deriveAssetManifestHash,
  deriveRuntimeIdempotencyKey,
  deriveRuntimeOperationHash,
  freezeRuntimeValue,
  hashRuntimeValue,
  immutableRuntimeAssetSchema,
  runtimeArtifactIdSchema,
  runtimeHashSchema,
  runtimeIdSchema,
  runtimeProtectionStateSchema,
  runtimePropertyProfileSchema,
  runtimePublicRuntimeSchema,
  runtimeTargetStateSchema,
  type AssetPreparationRequest,
  type AssetPreparationResult,
  type CompiledMutationPlan,
  type DeploymentSubmission,
} from '@/utils/siteforge/runtime-contract'
import {
  legalEvidenceId,
  siteForgeLegalConfigSchema,
  type SiteForgeLegalConfig,
} from '@/utils/siteforge/quality/deterministic-gates'

const runtimeLegalConfigSchema = z
  .record(z.string(), z.unknown())
  .superRefine((legal, context) => {
    if (!Object.hasOwn(legal, 'schemaVersion')) return
    const approved = siteForgeLegalConfigSchema.safeParse(legal)
    if (!approved.success) {
      context.addIssue({
        code: 'custom',
        message: 'Versioned SiteForge legal data must match the approved legal contract',
      })
    }
  })

export const immutableSiteForgeRuntimeReleaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    siteId: runtimeIdSchema,
    artifactId: runtimeArtifactIdSchema,
    artifactContentHash: runtimeHashSchema,
    assetManifestHash: runtimeHashSchema,
    siteName: z.string().min(1).max(500),
    tagline: z.string().max(2_000),
    propertyProfile: runtimePropertyProfileSchema.optional(),
    blueprint: siteBlueprintSchema,
    assets: z.array(immutableRuntimeAssetSchema).max(100),
    selectedAssets: z
      .object({
        logoAssetId: z.string().uuid().nullable(),
        faviconAssetId: z.string().uuid().nullable(),
      })
      .strict(),
    homepageSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    removals: z
      .object({
        pageKeys: z.array(runtimeIdSchema).default([]),
        pageSlugs: z
          .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
          .default([]),
      })
      .strict()
      .default({ pageKeys: [], pageSlugs: [] }),
    legal: runtimeLegalConfigSchema,
    analytics: z.record(z.string(), z.unknown()),
    target: runtimeTargetStateSchema.optional(),
    publicRuntime: runtimePublicRuntimeSchema.optional(),
    protection: runtimeProtectionStateSchema.optional(),
  })
  .strict()

export type ImmutableSiteForgeRuntimeRelease = z.infer<
  typeof immutableSiteForgeRuntimeReleaseSchema
>

export interface CompiledSiteForgeRuntimeRelease {
  readonly siteId: string
  readonly artifactId: string
  readonly artifactContentHash: string
  readonly assetManifestHash: string
  readonly assetPreparation: Readonly<AssetPreparationRequest>
  readonly plan: Readonly<CompiledMutationPlan>
  readonly operationHash: string
  readonly deploymentIdempotencyKey: string
}

export function compileSiteForgeRuntimeRelease(input: {
  release: Omit<ImmutableSiteForgeRuntimeRelease, 'blueprint'> & {
    blueprint: unknown
  }
  expectedRemoteContentHash: string | null
}): Readonly<CompiledSiteForgeRuntimeRelease> {
  if (
    hashRuntimeValue(input.release.blueprint) !==
    input.release.artifactContentHash
  ) {
    throw new Error(
      'Immutable SiteForge blueprint does not match artifactContentHash'
    )
  }
  const release = immutableSiteForgeRuntimeReleaseSchema.parse(input.release)
  const approvedLegal = siteForgeLegalConfigSchema.safeParse(release.legal)
  if (approvedLegal.success) {
    assertApprovedLegalPages(release.blueprint.pages, approvedLegal.data)
  }
  const expectedRemoteContentHash =
    input.expectedRemoteContentHash === null
      ? null
      : runtimeHashSchema.parse(input.expectedRemoteContentHash)

  const assets = [...release.assets].sort((left, right) =>
    left.assetId.localeCompare(right.assetId)
  )
  if (deriveAssetManifestHash(assets) !== release.assetManifestHash) {
    throw new Error(
      'Immutable SiteForge assets do not match assetManifestHash'
    )
  }
  assertSelectedAsset(
    release.selectedAssets.logoAssetId,
    'logo',
    assets
  )
  assertSelectedAsset(
    release.selectedAssets.faviconAssetId,
    'favicon',
    assets
  )
  if (!release.blueprint.siteConfiguration) {
    throw new Error(
      'Immutable SiteForge blueprint requires siteConfiguration for runtime deployment'
    )
  }

  const pages = release.blueprint.pages
    .map((page, index) => compilePage(page, index))
    .sort((left, right) => left.pageKey.localeCompare(right.pageKey))
  const pageBySlug = new Map(pages.map(page => [page.slug, page]))
  const homepage = pageBySlug.get(release.homepageSlug)
  if (!homepage) {
    throw new Error(
      `Selected homepage ${release.homepageSlug} is not in the immutable blueprint`
    )
  }

  const plan = compiledMutationPlanSchema.parse({
    pages,
    removals: {
      pageKeys: [...new Set(release.removals.pageKeys)].sort(),
      pageSlugs: [...new Set(release.removals.pageSlugs)].sort(),
    },
    navigation: compileNavigation(
      release.blueprint.siteConfiguration.navigation.items,
      pageBySlug
    ),
    designTokens: release.blueprint.siteConfiguration.design,
    siteSettings: {
      siteName: release.siteName,
      tagline: release.tagline,
      homepagePageKey: homepage.pageKey,
      logoAssetId: release.selectedAssets.logoAssetId,
      faviconAssetId: release.selectedAssets.faviconAssetId,
      propertyProfile: release.propertyProfile,
    },
    legal: approvedLegal.success ? approvedLegal.data : release.legal,
    analytics: release.analytics,
    siteConfiguration: release.blueprint.siteConfiguration,
    ...(release.target ? { target: release.target } : {}),
    ...(release.publicRuntime ? { publicRuntime: release.publicRuntime } : {}),
    ...(release.protection ? { protection: release.protection } : {}),
  })
  const operationHash = deriveRuntimeOperationHash(plan)
  const assetPreparation = assetPreparationRequestSchema.parse({
    contractVersion: SITEFORGE_RUNTIME_CONTRACT_VERSION,
    siteId: release.siteId,
    artifactId: release.artifactId,
    artifactContentHash: release.artifactContentHash,
    assetManifestHash: release.assetManifestHash,
    idempotencyKey: deriveRuntimeIdempotencyKey('asset_preparation', {
      siteId: release.siteId,
      artifactId: release.artifactId,
      artifactContentHash: release.artifactContentHash,
      payloadHash: release.assetManifestHash,
    }),
    assets,
  })
  const deploymentIdempotencyKey = deriveRuntimeIdempotencyKey('deployment', {
    siteId: release.siteId,
    artifactId: release.artifactId,
    artifactContentHash: release.artifactContentHash,
    expectedRemoteContentHash,
    payloadHash: operationHash,
  })

  return freezeRuntimeValue({
    siteId: release.siteId,
    artifactId: release.artifactId,
    artifactContentHash: release.artifactContentHash,
    assetManifestHash: release.assetManifestHash,
    assetPreparation,
    plan,
    operationHash,
    deploymentIdempotencyKey,
  })
}

export function createSiteForgeDeploymentSubmission(input: {
  compiled: CompiledSiteForgeRuntimeRelease
  assetPreparation: AssetPreparationResult
  expectedRemoteContentHash: string | null
}): Readonly<DeploymentSubmission> {
  const compiled = input.compiled
  const prepared = assetPreparationResultSchema.parse(input.assetPreparation)
  const expectedRemoteContentHash =
    input.expectedRemoteContentHash === null
      ? null
      : runtimeHashSchema.parse(input.expectedRemoteContentHash)
  if (
    prepared.siteId !== compiled.siteId ||
    prepared.artifactId !== compiled.artifactId ||
    prepared.artifactContentHash !== compiled.artifactContentHash ||
    prepared.assetManifestHash !== compiled.assetManifestHash
  ) {
    throw new Error(
      'Prepared assets do not belong to the compiled SiteForge artifact'
    )
  }
  const expectedIdempotencyKey = deriveRuntimeIdempotencyKey('deployment', {
    siteId: compiled.siteId,
    artifactId: compiled.artifactId,
    artifactContentHash: compiled.artifactContentHash,
    expectedRemoteContentHash,
    payloadHash: compiled.operationHash,
  })
  if (expectedIdempotencyKey !== compiled.deploymentIdempotencyKey) {
    throw new Error(
      'Expected remote content hash does not match the compiled deployment'
    )
  }

  return freezeRuntimeValue(
    deploymentSubmissionSchema.parse({
      contractVersion: SITEFORGE_RUNTIME_CONTRACT_VERSION,
      siteId: compiled.siteId,
      artifactId: compiled.artifactId,
      artifactContentHash: compiled.artifactContentHash,
      assetManifestHash: compiled.assetManifestHash,
      operationHash: compiled.operationHash,
      idempotencyKey: compiled.deploymentIdempotencyKey,
      expectedRemoteContentHash,
      assetPreparationId: prepared.preparationId,
      plan: compiled.plan,
    })
  )
}

function compilePage(
  page: GeneratedPage,
  sourceIndex: number
): CompiledMutationPlan['pages'][number] {
  const slug = normalizePageSlug(page.slug)
  if (!slug) {
    throw new Error('SiteForge runtime pages require a non-empty slug')
  }
  return {
    pageKey: pageKey(slug),
    slug,
    title: page.title,
    purpose: page.purpose,
    status: 'publish',
    menuOrder: sourceIndex,
    template: '',
    excerpt: '',
    seo: page.seo ?? null,
    sections: [...page.sections]
      .sort(compareSections)
      .map((section, index) => compileSection(section, index)),
  }
}

function assertApprovedLegalPages(
  pages: GeneratedPage[],
  legal: SiteForgeLegalConfig
): void {
  const expected = [
    [legal.privacyPath, legal.policyBodies.privacyPolicy],
    [legal.termsPath, legal.policyBodies.terms],
    [legal.accessibilityPath, legal.policyBodies.accessibility],
  ] as const
  const evidenceId = legalEvidenceId(legal)
  for (const [path, body] of expected) {
    const slug = normalizePageSlug(path)
    const matchingPages = pages.filter(page => normalizePageSlug(page.slug) === slug)
    const exactSections = matchingPages.flatMap(page =>
      page.sections.filter(
        section =>
          section.acfBlock === 'acf/text-section' &&
          section.content.content === body &&
          section.evidenceIds?.includes(evidenceId)
      )
    )
    if (matchingPages.length !== 1 || exactSections.length !== 1) {
      throw new Error(
        `Approved legal page ${path} does not match its exact policy body and provenance`
      )
    }
  }
}

function compileSection(
  section: PageSection,
  order: number
): CompiledMutationPlan['pages'][number]['sections'][number] {
  if (!section.id) {
    throw new Error(
      `SiteForge runtime compilation requires immutable section ids (${section.acfBlock})`
    )
  }
  const align = runtimeBlockAlignment(section.content.align)
  const content = section.presentation
    ? {
        ...section.content,
        _siteforge_presentation: section.presentation,
      }
    : { ...section.content }
  return {
    sectionId: section.id,
    blockName: section.acfBlock,
    order,
    variant: section.variant ?? null,
    anchor: section.id,
    ...(section.cssClasses !== undefined
      ? { cssClasses: [...section.cssClasses] }
      : {}),
    ...(align !== undefined ? { align } : {}),
    data: flattenAcfRepeaterFields(
      applyBlockFieldAliases(
        section.acfBlock,
        section.variant
          ? {
              ...content,
              variant: section.variant,
            }
          : content
      )
    ),
  }
}

function runtimeBlockAlignment(
  value: unknown
): 'wide' | 'full' | undefined {
  return value === 'wide' || value === 'full' ? value : undefined
}

function compileNavigation(
  items: Array<{
    id: string
    label: string
    href: string
    parentId?: string
    external?: boolean
  }>,
  pageBySlug: ReadonlyMap<string, CompiledMutationPlan['pages'][number]>
): CompiledMutationPlan['navigation'] {
  const configured =
    items.length > 0
      ? items
      : Array.from(pageBySlug.values()).map(page => ({
          id: `nav:${page.slug}`,
          label: page.title,
          href: page.slug === 'home' ? '/' : `/${page.slug}/`,
          parentId: undefined,
          external: false,
        }))
  const keys = new Set(configured.map(item => item.id))
  assertNavigationHierarchy(configured, keys)
  return {
    location: 'primary',
    name: 'SiteForge Primary',
    items: configured.map(item => {
      const slug = pageSlugFromHref(item.href)
      const page = slug ? pageBySlug.get(slug) : undefined
      return {
        itemKey: item.id,
        label: item.label,
        pageKey: page?.pageKey ?? null,
        url: page ? null : normalizeNavigationHref(item.href),
        parentItemKey: item.parentId ?? null,
        target: item.external ? ('_blank' as const) : ('_self' as const),
      }
    }),
  }
}

function assertNavigationHierarchy(
  items: ReadonlyArray<{ id: string; parentId?: string }>,
  keys: ReadonlySet<string>
): void {
  if (keys.size !== items.length) {
    throw new Error('SiteForge navigation item ids must be unique')
  }
  const parentById = new Map(items.map(item => [item.id, item.parentId] as const))
  for (const item of items) {
    if (item.parentId && !keys.has(item.parentId)) {
      throw new Error(
        `SiteForge navigation parent ${item.parentId} does not exist`
      )
    }
    const visited = new Set<string>()
    let cursor: string | undefined = item.id
    while (cursor !== undefined) {
      if (visited.has(cursor)) {
        throw new Error('SiteForge navigation hierarchy contains a cycle')
      }
      visited.add(cursor)
      cursor = parentById.get(cursor)
    }
  }
}

function assertSelectedAsset(
  assetId: string | null,
  role: 'logo' | 'favicon',
  assets: AssetPreparationRequest['assets']
): void {
  if (assetId === null) return
  const selected = assets.find(asset => asset.assetId === assetId)
  if (!selected) {
    throw new Error(`Selected ${role} asset ${assetId} is not in the release`)
  }
  if (selected.role !== role) {
    throw new Error(
      `Selected ${role} asset ${assetId} has immutable role ${selected.role}`
    )
  }
}

function pageKey(slug: string): string {
  return `page:${slug}`
}

function compareSections(left: PageSection, right: PageSection): number {
  const orderDifference = left.order - right.order
  return orderDifference || (left.id ?? '').localeCompare(right.id ?? '')
}

function normalizePageSlug(slug: string): string {
  return slug.trim().replace(/^\/+|\/+$/g, '').toLowerCase()
}

function pageSlugFromHref(href: string): string | null {
  if (/^https?:\/\//i.test(href.trim())) return null
  return normalizePageSlug(href) || 'home'
}

function normalizeNavigationHref(href: string): string {
  const trimmed = href.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const path = `/${trimmed.replace(/^\/+|\/+$/g, '')}`
  return path === '/' ? '/' : `${path}/`
}
