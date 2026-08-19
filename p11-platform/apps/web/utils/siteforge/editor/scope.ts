import { z } from 'zod'
import type {
  BlueprintPatchOperation,
  SiteBlueprint,
} from '@/types/siteforge'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export const siteForgeEditorScopeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('section'),
      pageSlug: z.string().trim().min(1).max(160),
      sectionId: z.string().trim().min(1).max(200),
      blockType: z.string().trim().min(1).max(160).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('page'),
      pageSlug: z.string().trim().min(1).max(160),
    })
    .strict(),
  z.object({ kind: z.literal('site') }).strict(),
])

export type SiteForgeEditorScope = z.infer<typeof siteForgeEditorScopeSchema>

const resourcePathSegmentPattern =
  '(?:[A-Za-z0-9._~@-]|%[0-9A-F]{2})+'
const resourcePathPattern = new RegExp(
  `^/(?:pages/by-slug/${resourcePathSegmentPattern}|sections/by-id/${resourcePathSegmentPattern}|runtimeRedirects/by-source/${resourcePathSegmentPattern}|siteConfiguration/(?:design|header|navigation|footer|media|motion|behavior))(?:/${resourcePathSegmentPattern})*$`
)

export const siteForgeEditorResourcePathSchema = z
  .string()
  .regex(resourcePathPattern, 'Expected a stable SiteForge resource path')
  .brand<'SiteForgeEditorResourcePath'>()
export type SiteForgeEditorResourcePath = z.infer<
  typeof siteForgeEditorResourcePathSchema
>

export type LegacyElementContext = {
  pageSlug: string
  sectionId: string
  blockType?: string
}

export function resolveSiteForgeEditorScope(input: {
  scope?: SiteForgeEditorScope
  elementContext?: LegacyElementContext
}): SiteForgeEditorScope {
  if (input.scope) return siteForgeEditorScopeSchema.parse(input.scope)
  if (input.elementContext) {
    return siteForgeEditorScopeSchema.parse({
      kind: 'section',
      ...input.elementContext,
    })
  }
  return { kind: 'site' }
}

function findSection(
  blueprint: SiteBlueprint,
  sectionId: string
): { pageSlug: string; blockType?: string } | null {
  const matches = blueprint.pages.flatMap(page =>
    (page.sections || [])
      .filter(section => section.id === sectionId)
      .map(section => ({
        pageSlug: page.slug,
        blockType: section.acfBlock,
      }))
  )
  if (matches.length !== 1) return null
  return matches[0]
}

function assertScopeExists(
  blueprint: SiteBlueprint,
  scope: SiteForgeEditorScope
): void {
  if (scope.kind === 'site') return
  const page = blueprint.pages.find(candidate => candidate.slug === scope.pageSlug)
  if (!page) {
    throw new Error(
      `[edit_scope_invalid] Page "${scope.pageSlug}" is not present in the immutable artifact`
    )
  }
  if (scope.kind === 'page') return
  const target = findSection(blueprint, scope.sectionId)
  if (!target || target.pageSlug !== scope.pageSlug) {
    throw new Error(
      `[edit_scope_invalid] Section "${scope.sectionId}" is not an exact persisted section on page "${scope.pageSlug}"`
    )
  }
  if (scope.blockType && target.blockType !== scope.blockType) {
    throw new Error(
      `[edit_scope_invalid] Section "${scope.sectionId}" block identity changed`
    )
  }
}

function operationSectionId(operation: BlueprintPatchOperation): string | null {
  return 'sectionId' in operation && typeof operation.sectionId === 'string'
    ? operation.sectionId
    : null
}

function operationPageSlug(
  operation: BlueprintPatchOperation,
  blueprint: SiteBlueprint
): string | null {
  if ('pageSlug' in operation && typeof operation.pageSlug === 'string') {
    return operation.pageSlug
  }
  const sectionId = operationSectionId(operation)
  return sectionId ? findSection(blueprint, sectionId)?.pageSlug || null : null
}

export function deriveSiteForgeEditorScopeForOperations(input: {
  blueprint: SiteBlueprint
  operations: BlueprintPatchOperation[]
  elementContext?: LegacyElementContext
}): SiteForgeEditorScope {
  if (input.operations.length === 0) {
    return resolveSiteForgeEditorScope({
      elementContext: input.elementContext,
    })
  }

  const sectionIds = new Set(
    input.operations
      .map(operationSectionId)
      .filter((value): value is string => Boolean(value))
  )
  if (
    sectionIds.size === 1 &&
    input.operations.every(operation => Boolean(operationSectionId(operation)))
  ) {
    const sectionId = [...sectionIds][0]
    const target = findSection(input.blueprint, sectionId)
    if (target) {
      return {
        kind: 'section',
        pageSlug: target.pageSlug,
        sectionId,
        blockType: target.blockType,
      }
    }
  }

  const pageSlugs = new Set(
    input.operations
      .map(operation => operationPageSlug(operation, input.blueprint))
      .filter((value): value is string => Boolean(value))
  )
  if (
    pageSlugs.size === 1 &&
    input.operations.every(operation =>
      Boolean(operationPageSlug(operation, input.blueprint))
    )
  ) {
    return { kind: 'page', pageSlug: [...pageSlugs][0] }
  }

  return { kind: 'site' }
}

function assertSectionScopeOperation(
  operation: BlueprintPatchOperation,
  scope: Extract<SiteForgeEditorScope, { kind: 'section' }>
): void {
  if (
    !['section.update', 'update_section'].includes(operation.op) ||
    operationSectionId(operation) !== scope.sectionId
  ) {
    throw new Error(
      `[edit_scope_violation] Section-targeted edit may only update "${scope.sectionId}", not run "${operation.op}"`
    )
  }
}

function assertPageScopeOperation(
  operation: BlueprintPatchOperation,
  scope: Extract<SiteForgeEditorScope, { kind: 'page' }>,
  blueprint: SiteBlueprint
): void {
  const allowed = new Set([
    'page.update',
    'page.move',
    'section.upsert',
    'section.update',
    'section.remove',
    'section.move',
    'add_section',
    'update_section',
    'remove_section',
    'move_section',
  ])
  if (!allowed.has(operation.op)) {
    throw new Error(
      `[edit_scope_violation] Page-targeted edit may not run "${operation.op}"; choose Whole site for global configuration changes`
    )
  }
  const operationPage = operationPageSlug(operation, blueprint)
  if (operationPage !== scope.pageSlug) {
    throw new Error(
      `[edit_scope_violation] Operation "${operation.op}" targets "${
        operationPage || 'an unknown page'
      }" instead of "${scope.pageSlug}"`
    )
  }
  if (
    operation.op === 'section.move' &&
    operation.pageSlug &&
    operation.pageSlug !== scope.pageSlug
  ) {
    throw new Error(
      `[edit_scope_violation] Section move leaves page "${scope.pageSlug}"`
    )
  }
}

export function assertSiteForgeEditorOperationsInScope(input: {
  blueprint: SiteBlueprint
  operations: BlueprintPatchOperation[]
  scope: SiteForgeEditorScope
}): void {
  assertScopeExists(input.blueprint, input.scope)
  if (input.scope.kind === 'site') return
  for (const operation of input.operations) {
    if (input.scope.kind === 'section') {
      assertSectionScopeOperation(operation, input.scope)
    } else {
      assertPageScopeOperation(operation, input.scope, input.blueprint)
    }
  }
}

function blueprintOutsideScope(
  blueprint: SiteBlueprint,
  scope: SiteForgeEditorScope
): unknown {
  const clone = structuredClone(blueprint) as SiteBlueprint
  clone.updatedAt = '__editor_updated_at__'
  if (scope.kind === 'site') return clone
  if (scope.kind === 'section') {
    clone.pages = clone.pages.map(page => ({
      ...page,
      sections: (page.sections || []).map(section =>
        page.slug === scope.pageSlug && section.id === scope.sectionId
          ? ({
              id: scope.sectionId,
              acfBlock: section.acfBlock,
              __target__: true,
            } as unknown as typeof section)
          : section
      ),
    }))
    return clone
  }
  clone.pages = clone.pages.filter(page => page.slug !== scope.pageSlug)
  return clone
}

export function assertSiteForgeEditorDiffInScope(input: {
  before: SiteBlueprint
  after: SiteBlueprint
  scope: SiteForgeEditorScope
}): void {
  if (input.scope.kind === 'site') return
  assertScopeExists(input.before, input.scope)
  const normalizedBefore =
    !input.before.siteConfiguration && input.after.siteConfiguration
      ? {
          ...input.before,
          siteConfiguration: input.after.siteConfiguration,
        }
      : input.before
  const beforeHash = hashSiteForgeContent(
    blueprintOutsideScope(normalizedBefore, input.scope)
  )
  const afterHash = hashSiteForgeContent(
    blueprintOutsideScope(input.after, input.scope)
  )
  if (beforeHash !== afterHash) {
    throw new Error(
      `[edit_scope_violation] The proposed ${input.scope.kind} edit changed content outside its selected target`
    )
  }
}

export function siteForgeEditorAffectedPaths(
  operations: BlueprintPatchOperation[]
): SiteForgeEditorResourcePath[] {
  return operations.flatMap(operation => {
    const sectionId = operationSectionId(operation)
    if (sectionId) {
      const base = `/sections/by-id/${encodeResourcePathSegment(sectionId)}`
      if (operation.op === 'section.update') {
        return nestedResourcePaths(base, operation.value)
      }
      if (operation.op === 'update_section') {
        const value = {
          content: operation.content,
          variant: operation.variant,
          cssClasses: operation.cssClasses,
          reasoning: operation.reasoning,
        }
        return nestedResourcePaths(
          base,
          Object.fromEntries(
            Object.entries(value).filter(([, entry]) => entry !== undefined)
          )
        )
      }
      if (operation.op === 'section.move' || operation.op === 'move_section') {
        return [resourcePath(`${base}/@position`)]
      }
      return [resourcePath(base)]
    }
    if (operation.op === 'page.upsert') {
      return [
        resourcePath(
          `/pages/by-slug/${encodeResourcePathSegment(operation.page.slug)}`
        ),
      ]
    }
    if (operation.op === 'redirect.upsert') {
      return [
        resourcePath(
          `/runtimeRedirects/by-source/${encodeResourcePathSegment(
            operation.redirect.sourcePath
          )}`
        ),
      ]
    }
    if ('pageSlug' in operation && operation.pageSlug) {
      const base = `/pages/by-slug/${encodeResourcePathSegment(
        operation.pageSlug
      )}`
      if (operation.op === 'page.update') {
        return nestedResourcePaths(base, operation.value)
      }
      if (operation.op === 'page.move') {
        return [resourcePath(`${base}/@position`)]
      }
      if (operation.op === 'section.upsert' || operation.op === 'add_section') {
        return [resourcePath(`${base}/sections`)]
      }
      return [resourcePath(base)]
    }
    const base = `/siteConfiguration/${operation.op.replace(/\.update$/, '')}`
    return 'value' in operation
      ? nestedResourcePaths(base, operation.value)
      : [resourcePath(base)]
  })
}

function encodeResourcePathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    character =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

function resourcePath(value: string): SiteForgeEditorResourcePath {
  return siteForgeEditorResourcePathSchema.parse(value)
}

function nestedResourcePaths(
  base: string,
  value: unknown
): SiteForgeEditorResourcePath[] {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length === 0
  ) {
    return [resourcePath(base)]
  }
  return Object.entries(value).flatMap(([key, nested]) =>
    nestedResourcePaths(
      `${base}/${encodeResourcePathSegment(key)}`,
      nested
    )
  )
}

export function siteForgeOperationsTouchThemeConfiguration(
  operations: BlueprintPatchOperation[]
): boolean {
  return operations.some(operation =>
    [
      'design.update',
      'header.update',
      'navigation.update',
      'footer.update',
      'media.update',
      'motion.update',
      'behavior.update',
    ].includes(operation.op)
  )
}
