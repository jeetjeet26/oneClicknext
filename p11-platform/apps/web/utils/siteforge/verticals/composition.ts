import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  composedVerticalManifestSchema,
  type ComposedVerticalManifest,
  type VerticalCompositionRequest,
  type VerticalPack,
  verticalCompositionRequestSchema,
} from './contracts'
import {
  assertVerticalPackIntegrity,
  normalizeVerticalPack,
  siteForgeVerticalRegistry,
  type RegisteredVerticalPack,
  type VerticalPackRegistry,
} from './registry'

export type VerticalCompositionErrorCode =
  | 'DUPLICATE_MODIFIER'
  | 'DUPLICATE_PACK'
  | 'PACK_NOT_APPLICABLE'
  | 'PACK_CONFLICT'
  | 'DUPLICATE_DECLARATION'
  | 'UNKNOWN_DECLARATION_REFERENCE'
  | 'PAGE_PATH_CONFLICT'

export class VerticalCompositionError extends Error {
  constructor(
    readonly code: VerticalCompositionErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(`${code}: ${message}`)
    this.name = 'VerticalCompositionError'
  }
}

function assertApplicable(
  pack: VerticalPack,
  selection: Omit<VerticalCompositionRequest, 'confirmedOverride'>
): void {
  const applicability = pack.applicability
  const applicable =
    applicability.scopes.includes(selection.scope) &&
    applicability.sectors.includes(selection.sector) &&
    applicability.transactions.includes(selection.transaction) &&
    applicability.archetypes.includes(selection.archetype) &&
    applicability.lifecycles.includes(selection.lifecycle)

  if (!applicable) {
    throw new VerticalCompositionError(
      'PACK_NOT_APPLICABLE',
      `${pack.key}@${pack.version} does not apply to the selected dimensions`,
      {
        pack: pack.key,
        selection,
        applicability,
      }
    )
  }
}

function assertPackIdentitiesUnique(
  packs: readonly RegisteredVerticalPack[]
): void {
  const seen = new Set<string>()
  for (const pack of packs) {
    const identity = `${pack.key}@${pack.version}`
    if (seen.has(identity)) {
      throw new VerticalCompositionError(
        'DUPLICATE_PACK',
        `${identity} was selected more than once`,
        { identity }
      )
    }
    seen.add(identity)
  }
}

function assertNoPackConflicts(
  packs: readonly RegisteredVerticalPack[]
): void {
  const selectedKeys = new Set(packs.map(pack => pack.key))
  const exclusiveClaims = new Map<string, string>()

  for (const pack of packs) {
    const conflictingKey = pack.conflictsWith.find(key => selectedKeys.has(key))
    if (conflictingKey) {
      throw new VerticalCompositionError(
        'PACK_CONFLICT',
        `${pack.key} conflicts with ${conflictingKey}`,
        { pack: pack.key, conflictingKey }
      )
    }

    for (const claim of pack.exclusiveClaims) {
      const owner = exclusiveClaims.get(claim)
      if (owner && owner !== pack.key) {
        throw new VerticalCompositionError(
          'PACK_CONFLICT',
          `${pack.key} and ${owner} both claim ${claim}`,
          { claim, packs: [owner, pack.key] }
        )
      }
      exclusiveClaims.set(claim, pack.key)
    }
  }
}

function appendUniqueById<T extends { id: string }>(
  target: T[],
  incoming: readonly T[],
  collection: string,
  owner: string,
  ids: Set<string>
): void {
  for (const value of incoming) {
    if (ids.has(value.id)) {
      throw new VerticalCompositionError(
        'DUPLICATE_DECLARATION',
        `${collection} id ${value.id} was declared more than once`,
        { collection, id: value.id, owner }
      )
    }
    ids.add(value.id)
    target.push(value)
  }
}

function appendUniqueStrings<T extends string>(
  target: T[],
  incoming: readonly T[],
  seen: Set<T>
): void {
  for (const value of incoming) {
    if (!seen.has(value)) {
      seen.add(value)
      target.push(value)
    }
  }
}

function registeredOverride(pack: VerticalPack): RegisteredVerticalPack {
  const normalized = normalizeVerticalPack(pack)
  assertVerticalPackIntegrity(normalized)
  return {
    ...normalized,
    contentHash: hashSiteForgeContent(normalized),
  }
}

export function composeVerticalPacks(
  rawRequest: VerticalCompositionRequest,
  registry: VerticalPackRegistry = siteForgeVerticalRegistry
): ComposedVerticalManifest {
  if (
    Array.isArray(rawRequest.modifiers) &&
    new Set(rawRequest.modifiers).size !== rawRequest.modifiers.length
  ) {
    throw new VerticalCompositionError(
      'DUPLICATE_MODIFIER',
      'Modifier selectors must be unique'
    )
  }
  const request = verticalCompositionRequestSchema.parse(rawRequest)

  const selection = {
    registryVersion: request.registryVersion,
    scope: request.scope,
    sector: request.sector,
    transaction: request.transaction,
    archetype: request.archetype,
    modifiers: [...request.modifiers].sort((a, b) => a.localeCompare(b)),
    lifecycle: request.lifecycle,
  }
  const packs = registry.resolveSelection({
    ...selection,
    confirmedOverride: null,
  })
  if (request.confirmedOverride) {
    if (request.confirmedOverride.version !== request.registryVersion) {
      throw new Error(
        `PACK_VERSION_MISMATCH: confirmed override ${request.confirmedOverride.key}@${request.confirmedOverride.version}`
      )
    }
    packs.push(registeredOverride(request.confirmedOverride))
  }

  assertPackIdentitiesUnique(packs)
  for (const pack of packs) assertApplicable(pack, selection)
  assertNoPackConflicts(packs)

  const requiredEvidence: ComposedVerticalManifest['requiredEvidence'] = []
  const optionalEvidence: ComposedVerticalManifest['optionalEvidence'] = []
  const decisionIds: string[] = []
  const questionIds: string[] = []
  const pages: ComposedVerticalManifest['pages'] = []
  const offeringKinds: ComposedVerticalManifest['offeringKinds'] = []
  const conversionIntentRecipes: ComposedVerticalManifest['conversionIntentRecipes'] =
    []
  const seoSchemaTypes: ComposedVerticalManifest['seoSchemaTypes'] = []
  const policyCodes: ComposedVerticalManifest['policyCodes'] = []
  const forbiddenClaims: string[] = []
  const analyticsOutcomes: ComposedVerticalManifest['analyticsOutcomes'] = []
  const freshnessRules: ComposedVerticalManifest['freshnessRules'] = []
  const lifecycleOverrides: ComposedVerticalManifest['lifecycleOverrides'] = []

  const declarationIds = new Set<string>()
  const decisionIdSet = new Set<string>()
  const questionIdSet = new Set<string>()
  const offeringKindSet = new Set<(typeof offeringKinds)[number]>()
  const seoSchemaTypeSet = new Set<(typeof seoSchemaTypes)[number]>()
  const policyCodeSet = new Set<(typeof policyCodes)[number]>()
  const forbiddenClaimSet = new Set<string>()
  const pagePaths = new Map<string, string>()

  for (const pack of packs) {
    appendUniqueById(
      requiredEvidence,
      pack.requiredEvidence,
      'requiredEvidence',
      pack.key,
      declarationIds
    )
    appendUniqueById(
      optionalEvidence,
      pack.optionalEvidence,
      'optionalEvidence',
      pack.key,
      declarationIds
    )
    for (const decisionId of pack.decisionIds) {
      if (declarationIds.has(decisionId)) {
        throw new VerticalCompositionError(
          'DUPLICATE_DECLARATION',
          `decision id ${decisionId} was declared more than once`,
          { id: decisionId, owner: pack.key }
        )
      }
      declarationIds.add(decisionId)
    }
    appendUniqueStrings(decisionIds, pack.decisionIds, decisionIdSet)
    for (const questionId of pack.questionIds) {
      if (declarationIds.has(questionId)) {
        throw new VerticalCompositionError(
          'DUPLICATE_DECLARATION',
          `question id ${questionId} was declared more than once`,
          { id: questionId, owner: pack.key }
        )
      }
      declarationIds.add(questionId)
    }
    appendUniqueStrings(questionIds, pack.questionIds, questionIdSet)

    for (const page of pack.pages) {
      const existingPage = pagePaths.get(page.slug)
      if (existingPage && existingPage !== page.id) {
        throw new VerticalCompositionError(
          'PAGE_PATH_CONFLICT',
          `${page.slug} is declared by both ${existingPage} and ${page.id}`,
          { slug: page.slug, pageIds: [existingPage, page.id] }
        )
      }
      pagePaths.set(page.slug, page.id)
      appendUniqueById(pages, [page], 'pages', pack.key, declarationIds)
      appendUniqueById(
        [],
        page.sections,
        'pageSections',
        pack.key,
        declarationIds
      )
    }

    appendUniqueStrings(
      offeringKinds,
      pack.offeringKinds,
      offeringKindSet
    )
    appendUniqueById(
      conversionIntentRecipes,
      pack.conversionIntentRecipes,
      'conversionIntentRecipes',
      pack.key,
      declarationIds
    )
    appendUniqueStrings(
      seoSchemaTypes,
      pack.seoSchemaTypes,
      seoSchemaTypeSet
    )
    appendUniqueStrings(policyCodes, pack.policyCodes, policyCodeSet)
    appendUniqueStrings(
      forbiddenClaims,
      pack.forbiddenClaims,
      forbiddenClaimSet
    )
    appendUniqueById(
      analyticsOutcomes,
      pack.analyticsOutcomes,
      'analyticsOutcomes',
      pack.key,
      declarationIds
    )
    appendUniqueById(
      freshnessRules,
      pack.freshnessRules,
      'freshnessRules',
      pack.key,
      declarationIds
    )
    appendUniqueById(
      lifecycleOverrides,
      pack.lifecycleOverrides,
      'lifecycleOverrides',
      pack.key,
      declarationIds
    )
  }

  const requiredEvidenceIds = new Set(
    requiredEvidence.map(evidence => evidence.id)
  )
  const pageIds = new Set(pages.map(page => page.id))
  for (const recipe of conversionIntentRecipes) {
    for (const evidenceId of recipe.requiredEvidenceIds) {
      if (!requiredEvidenceIds.has(evidenceId)) {
        throw new VerticalCompositionError(
          'UNKNOWN_DECLARATION_REFERENCE',
          `${recipe.id} references unknown required evidence ${evidenceId}`,
          { recipeId: recipe.id, evidenceId }
        )
      }
    }
  }
  for (const override of lifecycleOverrides) {
    for (const evidenceId of override.requiredEvidenceIds) {
      if (!requiredEvidenceIds.has(evidenceId)) {
        throw new VerticalCompositionError(
          'UNKNOWN_DECLARATION_REFERENCE',
          `${override.id} references unknown required evidence ${evidenceId}`,
          { overrideId: override.id, evidenceId }
        )
      }
    }
    for (const pageId of [
      ...override.activatePageIds,
      ...override.deactivatePageIds,
    ]) {
      if (!pageIds.has(pageId)) {
        throw new VerticalCompositionError(
          'UNKNOWN_DECLARATION_REFERENCE',
          `${override.id} references unknown page ${pageId}`,
          { overrideId: override.id, pageId }
        )
      }
    }
  }

  const body = {
    schemaVersion: 1 as const,
    registryVersion: request.registryVersion,
    selection,
    packs: packs.map(pack => ({
      key: pack.key,
      version: pack.version,
      contentHash: pack.contentHash,
      layer: pack.layer,
      selector: pack.selector,
    })),
    requiredEvidence,
    optionalEvidence,
    decisionIds,
    questionIds,
    pages,
    offeringKinds,
    conversionIntentRecipes,
    seoSchemaTypes,
    policyCodes,
    forbiddenClaims,
    analyticsOutcomes,
    freshnessRules,
    lifecycleOverrides,
  }

  return composedVerticalManifestSchema.parse({
    ...body,
    contentHash: hashSiteForgeContent(body),
  })
}
