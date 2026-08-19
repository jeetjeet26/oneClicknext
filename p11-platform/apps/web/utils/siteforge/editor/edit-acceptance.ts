import { z } from 'zod'
import type {
  BlueprintPatchOperation,
  SiteBlueprint,
} from '@/types/siteforge'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export const SITEFORGE_EDIT_ACCEPTANCE_VERSION =
  'siteforge-edit-acceptance-v1' as const
export const SITEFORGE_NAMED_VIEWPORTS = [
  'desktop',
  'tablet',
  'mobile',
] as const

const viewportSchema = z.enum(SITEFORGE_NAMED_VIEWPORTS)
const artifactIdentitySchema = z
  .object({
    artifactId: z.string().uuid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
const pendingArtifactIdentitySchema = artifactIdentitySchema.extend({
  artifactId: z.string().uuid().nullable(),
})
const resourceSchema = z
  .object({
    path: z.string().min(1).max(500),
    pageSlug: z.string().min(1).max(160),
    selector: z.string().min(1).max(500),
  })
  .strict()
const selectorExpectationSchema = resourceSchema.extend({
  expectationId: z.string().min(1).max(200),
})

export const siteForgeEditAcceptanceContractSchema = z
  .object({
    contractVersion: z.literal(SITEFORGE_EDIT_ACCEPTANCE_VERSION),
    contractHash: z.string().regex(/^[a-f0-9]{64}$/),
    parentArtifact: artifactIdentitySchema,
    editedArtifact: pendingArtifactIdentitySchema,
    changedResources: z.array(resourceSchema).min(1).max(200),
    expectedText: z
      .array(
        selectorExpectationSchema.extend({
          value: z.string().min(1).max(500),
          mode: z.enum(['contains', 'absent']),
        })
      )
      .max(200),
    expectedAttributes: z
      .array(
        selectorExpectationSchema.extend({
          attribute: z.string().min(1).max(120),
          value: z.string().max(500).nullable(),
          mode: z.enum(['equals', 'contains', 'absent']),
        })
      )
      .max(200),
    expectedComputedStyles: z
      .array(
        selectorExpectationSchema.extend({
          property: z.string().min(1).max(160),
          value: z.string().min(1).max(500),
          mustDifferFromParent: z.boolean(),
        })
      )
      .max(100),
    expectedInteractions: z
      .array(
        selectorExpectationSchema.extend({
          action: z.enum(['click', 'focus']),
          expectedAttribute: z
            .object({
              name: z.string().min(1).max(120),
              value: z.string().max(500),
            })
            .strict()
            .optional(),
        })
      )
      .max(100),
    requiredViewports: z.array(viewportSchema).min(1),
    unchangedRegions: z.array(resourceSchema).max(500),
  })
  .strict()
  .superRefine((contract, context) => {
    const hashable: Partial<typeof contract> = { ...contract }
    delete hashable.contractHash
    if (hashSiteForgeContent(hashable) !== contract.contractHash) {
      context.addIssue({
        code: 'custom',
        path: ['contractHash'],
        message: 'Edit acceptance contract hash does not match its contents',
      })
    }
  })

export type SiteForgeEditAcceptanceContract = z.infer<
  typeof siteForgeEditAcceptanceContractSchema
>

export const siteForgeRenderedEditObservationSchema = z
  .object({
    phase: z.enum(['parent', 'edited']),
    viewport: viewportSchema,
    pageSlug: z.string().min(1).max(160),
    selector: z.string().min(1).max(500),
    matched: z.number().int().min(0),
    text: z.string().max(20_000),
    attributes: z.record(z.string(), z.string().nullable()),
    computedStyles: z.record(z.string(), z.string()),
    interactionAttributes: z.record(z.string(), z.string().nullable()),
    regionHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  })
  .strict()

export const siteForgeEditAcceptanceFailureSchema = z
  .object({
    code: z.enum([
      'parent_render_unavailable',
      'edited_render_unavailable',
      'required_viewport_missing',
      'selector_unmatched',
      'removed_selector_still_present',
      'expected_text_missing',
      'expected_text_still_present',
      'attribute_mismatch',
      'computed_style_mismatch',
      'ineffective_style_change',
      'interaction_mismatch',
      'unchanged_region_drift',
    ]),
    path: z.string().min(1).max(500),
    pageSlug: z.string().min(1).max(160),
    selector: z.string().min(1).max(500),
    viewport: viewportSchema,
    expected: z.string().max(2_000),
    actual: z.string().max(2_000),
    repairHint: z.string().min(1).max(2_000),
  })
  .strict()

export const siteForgeRenderedEditEvidenceSchema = z
  .object({
    evidenceVersion: z.literal(SITEFORGE_EDIT_ACCEPTANCE_VERSION),
    contractHash: z.string().regex(/^[a-f0-9]{64}$/),
    parentArtifact: artifactIdentitySchema,
    editedArtifact: artifactIdentitySchema,
    parentTargetUrl: z.string().url().nullable(),
    editedTargetUrl: z.string().url(),
    observations: z.array(siteForgeRenderedEditObservationSchema).max(2_000),
    passed: z.boolean(),
    failures: z.array(siteForgeEditAcceptanceFailureSchema).max(500),
  })
  .strict()

export type SiteForgeRenderedEditObservation = z.infer<
  typeof siteForgeRenderedEditObservationSchema
>
export type SiteForgeRenderedEditEvidence = z.infer<
  typeof siteForgeRenderedEditEvidenceSchema
>
export type SiteForgeEditAcceptanceFailure = z.infer<
  typeof siteForgeEditAcceptanceFailureSchema
>

type Page = SiteBlueprint['pages'][number]
type Section = Page['sections'][number]

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function pagePath(slug: string): string {
  return slug === 'home' ? '/' : `/${slug}/`
}

function sectionSelector(sectionId: string): string {
  const escaped = escapeAttribute(sectionId)
  return `[id="${escaped}"],[data-siteforge-section-id="${escaped}"]`
}

function findSection(
  blueprint: SiteBlueprint,
  sectionId: string
): { page: Page; section: Section } | null {
  for (const page of blueprint.pages) {
    const section = page.sections.find(candidate => candidate.id === sectionId)
    if (section) return { page, section }
  }
  return null
}

function collectText(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') {
    const normalized = value
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (normalized.length >= 2 && normalized.length <= 500) {
      output.push(normalized)
    }
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output)
    return output
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectText(item, output)
  }
  return output
}

function operationLocations(
  before: SiteBlueprint,
  after: SiteBlueprint,
  operation: BlueprintPatchOperation
): Array<{ pageSlug: string; sectionId?: string; removed?: boolean }> {
  const op = operation as BlueprintPatchOperation & Record<string, unknown>
  if (operation.op === 'page.upsert') {
    return [{ pageSlug: operation.page.slug }]
  }
  if (operation.op === 'page.remove') {
    return [{ pageSlug: operation.pageSlug, removed: true }]
  }
  if (operation.op === 'page.update' || operation.op === 'page.move') {
    return [{ pageSlug: operation.pageSlug }]
  }
  if (operation.op === 'redirect.upsert') {
    return [
      {
        pageSlug:
          operation.redirect.sourcePath.replace(/^\/+|\/+$/g, '') || 'home',
      },
    ]
  }
  if (
    operation.op === 'section.upsert' ||
    operation.op === 'add_section'
  ) {
    const beforeIds = new Set(
      before.pages
        .find(page => page.slug === operation.pageSlug)
        ?.sections.flatMap(section => section.id || []) || []
    )
    const addedId = after.pages
      .find(page => page.slug === operation.pageSlug)
      ?.sections.find(section => section.id && !beforeIds.has(section.id))?.id
    const sectionId =
      operation.op === 'section.upsert'
        ? operation.sectionId || addedId
        : addedId
    return [{ pageSlug: operation.pageSlug, sectionId }]
  }
  if (typeof op.sectionId === 'string') {
    const beforeLocation = findSection(before, op.sectionId)
    const afterLocation = findSection(after, op.sectionId)
    return [
      {
        pageSlug:
          (typeof op.pageSlug === 'string' ? op.pageSlug : null) ||
          afterLocation?.page.slug ||
          beforeLocation?.page.slug ||
          'home',
        sectionId: op.sectionId,
        removed:
          operation.op === 'section.remove' ||
          operation.op === 'remove_section',
      },
    ]
  }
  return before.pages.map(page => ({ pageSlug: page.slug }))
}

function styleExpectations(
  operations: BlueprintPatchOperation[]
): SiteForgeEditAcceptanceContract['expectedComputedStyles'] {
  const styles: SiteForgeEditAcceptanceContract['expectedComputedStyles'] = []
  const push = (property: string, value: unknown, id: string) => {
    if (typeof value !== 'string' && typeof value !== 'number') return
    styles.push({
      expectationId: id,
      path: '/siteConfiguration/design',
      pageSlug: 'home',
      selector: ':root',
      property,
      value: String(value),
      mustDifferFromParent: true,
    })
  }
  for (const operation of operations) {
    const op = operation as BlueprintPatchOperation & {
      value?: Record<string, unknown>
    }
    if (operation.op === 'design.update') {
      const design = record(op.value)
      const colors = record(design.colors)
      const typography = record(design.typography)
      const spacing = record(design.spacing)
      push('--color-primary', colors.primary, 'design-primary-color')
      push('--color-secondary', colors.secondary, 'design-secondary-color')
      push('--color-accent', colors.accent, 'design-accent-color')
      push('--color-background', colors.background, 'design-background-color')
      push('--color-text', colors.text, 'design-text-color')
      push('--font-heading', typography.headingFont, 'design-heading-font')
      push('--font-body', typography.bodyFont, 'design-body-font')
      push(
        '--container-max-width',
        spacing.containerMaxWidth,
        'design-container-width'
      )
      push('--section-padding', spacing.sectionPadding, 'design-section-padding')
    }
    if (operation.op === 'motion.update') {
      const motion = record(op.value)
      const duration = motion.durationMs
      push(
        '--siteforge-motion-duration',
        typeof duration === 'number' ? `${duration}ms` : undefined,
        'motion-duration'
      )
      push(
        '--siteforge-motion-easing',
        motion.easing,
        'motion-easing'
      )
    }
  }
  return styles
}

export function deriveSiteForgeEditAcceptanceContract(input: {
  before: SiteBlueprint
  after: SiteBlueprint
  operations: BlueprintPatchOperation[]
  parentArtifact: { artifactId: string; contentHash: string }
  editedArtifact: { artifactId: string | null; contentHash: string }
}): SiteForgeEditAcceptanceContract {
  const locations = input.operations.flatMap(operation =>
    operationLocations(input.before, input.after, operation)
  )
  const uniqueLocations = [
    ...new Map(
      locations.map(location => [
        `${location.pageSlug}:${location.sectionId || ''}:${location.removed || false}`,
        location,
      ])
    ).values(),
  ]
  const changedResources = uniqueLocations.map(location => ({
    path: location.sectionId
      ? `/pages/${location.pageSlug}/sections/${location.sectionId}`
      : `/pages/${location.pageSlug}`,
    pageSlug: location.pageSlug,
    selector: location.sectionId
      ? sectionSelector(location.sectionId)
      : 'body',
  }))
  const expectedText: SiteForgeEditAcceptanceContract['expectedText'] = []
  const expectedAttributes: SiteForgeEditAcceptanceContract['expectedAttributes'] =
    []
  for (const [index, location] of uniqueLocations.entries()) {
    const selector = location.sectionId
      ? sectionSelector(location.sectionId)
      : 'body'
    const path = location.sectionId
      ? `/pages/${location.pageSlug}/sections/${location.sectionId}`
      : `/pages/${location.pageSlug}`
    if (location.removed) {
      if (location.sectionId) {
        expectedAttributes.push({
          expectationId: `removed-${index}`,
          path,
          pageSlug: location.pageSlug,
          selector,
          attribute: 'data-siteforge-presence',
          value: null,
          mode: 'absent',
        })
      } else {
        const priorPage = input.before.pages.find(
          candidate => candidate.slug === location.pageSlug
        )
        for (const [textIndex, text] of [
          ...new Set(
            collectText({
              title: priorPage?.title,
              sections: priorPage?.sections.map(section => section.content),
            }).slice(0, 12)
          ),
        ].entries()) {
          expectedText.push({
            expectationId: `removed-page-text-${index}-${textIndex}`,
            path,
            pageSlug: location.pageSlug,
            selector,
            value: text,
            mode: 'absent',
          })
        }
      }
      continue
    }
    const page = input.after.pages.find(
      candidate => candidate.slug === location.pageSlug
    )
    const value = location.sectionId
      ? page?.sections.find(section => section.id === location.sectionId)
      : page
    const renderedTextSource = location.sectionId
      ? (value as Section | undefined)?.content
      : {
          title: page?.title,
          sections: page?.sections.map(section => section.content),
        }
    for (const [textIndex, text] of [
      ...new Set(collectText(renderedTextSource).slice(0, 12)),
    ].entries()) {
      expectedText.push({
        expectationId: `text-${index}-${textIndex}`,
        path,
        pageSlug: location.pageSlug,
        selector,
        value: text,
        mode: 'contains',
      })
    }
    if (location.sectionId && value) {
      const section = value as Section
      if (section.variant) {
        expectedAttributes.push({
          expectationId: `variant-${index}`,
          path,
          pageSlug: location.pageSlug,
          selector,
          attribute: 'data-siteforge-variant',
          value: section.variant,
          mode: 'equals',
        })
      }
      for (const [classIndex, className] of (section.cssClasses || []).entries()) {
        expectedAttributes.push({
          expectationId: `class-${index}-${classIndex}`,
          path,
          pageSlug: location.pageSlug,
          selector,
          attribute: 'class',
          value: className,
          mode: 'contains',
        })
      }
    }
  }

  const changedSectionIds = new Set(
    uniqueLocations.flatMap(location => location.sectionId || [])
  )
  const changedPages = new Set(
    input.operations.flatMap(operation =>
      operation.op === 'page.upsert'
        ? [operation.page.slug]
        : operation.op === 'page.remove'
          ? [operation.pageSlug]
          : []
    )
  )
  const unchangedRegions = input.before.pages.flatMap(page =>
    changedPages.has(page.slug)
      ? []
      : page.sections.flatMap(section =>
          section.id && !changedSectionIds.has(section.id)
            ? [
                {
                  path: `/pages/${page.slug}/sections/${section.id}`,
                  pageSlug: page.slug,
                  selector: sectionSelector(section.id),
                },
              ]
            : []
        )
  )
  const hashable = {
    contractVersion: SITEFORGE_EDIT_ACCEPTANCE_VERSION,
    parentArtifact: input.parentArtifact,
    editedArtifact: input.editedArtifact,
    changedResources,
    expectedText,
    expectedAttributes,
    expectedComputedStyles: styleExpectations(input.operations),
    expectedInteractions: [],
    requiredViewports: [...SITEFORGE_NAMED_VIEWPORTS],
    unchangedRegions,
  }
  return siteForgeEditAcceptanceContractSchema.parse({
    ...hashable,
    contractHash: hashSiteForgeContent(hashable),
  })
}

function observationKey(
  phase: SiteForgeRenderedEditObservation['phase'],
  viewport: SiteForgeRenderedEditObservation['viewport'],
  pageSlug: string,
  selector: string
): string {
  return `${phase}|${viewport}|${pageSlug}|${selector}`
}

function truncate(value: unknown): string {
  const rendered =
    typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return rendered.slice(0, 2_000)
}

export function evaluateSiteForgeRenderedEditEvidence(input: {
  contract: SiteForgeEditAcceptanceContract
  editedArtifactId?: string
  parentTargetUrl: string | null
  editedTargetUrl: string
  observations: SiteForgeRenderedEditObservation[]
}): SiteForgeRenderedEditEvidence {
  const contract = siteForgeEditAcceptanceContractSchema.parse(input.contract)
  const observations = input.observations.map(observation =>
    siteForgeRenderedEditObservationSchema.parse(observation)
  )
  const byKey = new Map(
    observations.map(observation => [
      observationKey(
        observation.phase,
        observation.viewport,
        observation.pageSlug,
        observation.selector
      ),
      observation,
    ])
  )
  const failures: SiteForgeEditAcceptanceFailure[] = []
  const addFailure = (
    code: SiteForgeEditAcceptanceFailure['code'],
    resource: { path: string; pageSlug: string; selector: string },
    viewport: SiteForgeEditAcceptanceFailure['viewport'],
    expected: unknown,
    actual: unknown,
    repairHint: string
  ) => {
    failures.push({
      code,
      path: resource.path,
      pageSlug: resource.pageSlug,
      selector: resource.selector,
      viewport,
      expected: truncate(expected),
      actual: truncate(actual),
      repairHint,
    })
  }
  const edited = (
    viewport: SiteForgeEditAcceptanceFailure['viewport'],
    resource: { pageSlug: string; selector: string }
  ) =>
    byKey.get(
      observationKey('edited', viewport, resource.pageSlug, resource.selector)
    )
  const parent = (
    viewport: SiteForgeEditAcceptanceFailure['viewport'],
    resource: { pageSlug: string; selector: string }
  ) =>
    byKey.get(
      observationKey('parent', viewport, resource.pageSlug, resource.selector)
    )
  const removedSelectors = new Set(
    contract.expectedAttributes
      .filter(
        expectation =>
          expectation.mode === 'absent' &&
          expectation.attribute === 'data-siteforge-presence'
      )
      .map(
        expectation =>
          `${expectation.pageSlug}|${expectation.selector}`
      )
  )

  for (const viewport of contract.requiredViewports) {
    if (!input.parentTargetUrl) {
      addFailure(
        'parent_render_unavailable',
        contract.changedResources[0],
        viewport,
        contract.parentArtifact,
        null,
        'Render the immutable parent artifact at a stable review URL and rerun certification.'
      )
    }
    for (const resource of contract.changedResources) {
      const actual = edited(viewport, resource)
      if (!actual) {
        addFailure(
          'required_viewport_missing',
          resource,
          viewport,
          'edited observation',
          null,
          'Capture this exact page, selector, and named viewport.'
        )
      } else if (
        actual.matched === 0 &&
        !removedSelectors.has(`${resource.pageSlug}|${resource.selector}`)
      ) {
        addFailure(
          'selector_unmatched',
          resource,
          viewport,
          'at least one rendered element',
          0,
          'Repair the operation target or rendered selector; do not publish selector guesses.'
        )
      }
    }
    for (const expectation of contract.expectedText) {
      const actual = edited(viewport, expectation)
      if (!actual || actual.matched === 0) continue
      const present = actual.text.includes(expectation.value)
      if (
        (expectation.mode === 'contains' && !present) ||
        (expectation.mode === 'absent' && present)
      ) {
        addFailure(
          expectation.mode === 'contains'
            ? 'expected_text_missing'
            : 'expected_text_still_present',
          expectation,
          viewport,
          `${expectation.mode}: ${expectation.value}`,
          actual.text,
          'Repair the semantic operation or renderer mapping so the accepted copy reaches the DOM.'
        )
      }
    }
    for (const expectation of contract.expectedAttributes) {
      const actual = edited(viewport, expectation)
      const value = actual?.attributes[expectation.attribute] ?? null
      const passed =
        expectation.mode === 'absent'
          ? !actual || actual.matched === 0 || value === null
          : expectation.mode === 'equals'
            ? value === expectation.value
            : value?.split(/\s+/).includes(expectation.value || '') === true
      if (!passed) {
        addFailure(
          expectation.mode === 'absent' && expectation.attribute ===
            'data-siteforge-presence'
            ? 'removed_selector_still_present'
            : 'attribute_mismatch',
          expectation,
          viewport,
          `${expectation.mode}: ${expectation.attribute}=${expectation.value}`,
          value,
          'Repair the renderer attribute/class mapping for this exact resource.'
        )
      }
    }
    for (const expectation of contract.expectedComputedStyles) {
      const actual = edited(viewport, expectation)
      const prior = parent(viewport, expectation)
      const actualValue = actual?.computedStyles[expectation.property] || ''
      const priorValue = prior?.computedStyles[expectation.property] || ''
      if (!actual || actual.matched === 0 || actualValue !== expectation.value) {
        addFailure(
          'computed_style_mismatch',
          expectation,
          viewport,
          `${expectation.property}: ${expectation.value}`,
          actualValue,
          'Repair the compiled style token or selector and recapture computed styles.'
        )
      } else if (
        expectation.mustDifferFromParent &&
        prior &&
        actualValue === priorValue
      ) {
        addFailure(
          'ineffective_style_change',
          expectation,
          viewport,
          `different from parent value ${priorValue}`,
          actualValue,
          'Remove the ineffective CSS or increase selector/runtime specificity without weakening the contract.'
        )
      }
    }
    for (const expectation of contract.expectedInteractions) {
      const actual = edited(viewport, expectation)
      const attribute = expectation.expectedAttribute
      const passed =
        actual &&
        actual.matched > 0 &&
        (!attribute ||
          actual.interactionAttributes[attribute.name] === attribute.value)
      if (!passed) {
        addFailure(
          'interaction_mismatch',
          expectation,
          viewport,
          attribute || expectation.action,
          actual?.interactionAttributes || null,
          'Repair the bounded interaction and rerun the named-viewport browser action.'
        )
      }
    }
    for (const region of contract.unchangedRegions) {
      const prior = parent(viewport, region)
      const actual = edited(viewport, region)
      if (
        !prior ||
        !actual ||
        prior.matched === 0 ||
        actual.matched === 0 ||
        !prior.regionHash ||
        prior.regionHash !== actual.regionHash
      ) {
        addFailure(
          'unchanged_region_drift',
          region,
          viewport,
          prior?.regionHash || 'parent region hash',
          actual?.regionHash || null,
          'Constrain the edit to its declared resources or explicitly expand and recertify the contract.'
        )
      }
    }
  }

  return siteForgeRenderedEditEvidenceSchema.parse({
    evidenceVersion: SITEFORGE_EDIT_ACCEPTANCE_VERSION,
    contractHash: contract.contractHash,
    parentArtifact: contract.parentArtifact,
    editedArtifact: {
      artifactId:
        contract.editedArtifact.artifactId || input.editedArtifactId,
      contentHash: contract.editedArtifact.contentHash,
    },
    parentTargetUrl: input.parentTargetUrl,
    editedTargetUrl: input.editedTargetUrl,
    observations,
    passed: failures.length === 0,
    failures,
  })
}

export function siteForgePageUrl(baseUrl: string, slug: string): string {
  return new URL(pagePath(slug), baseUrl).toString()
}
