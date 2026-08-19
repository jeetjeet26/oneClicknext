import { describe, expect, it } from 'vitest'
import {
  SITEFORGE_VERTICAL_AMBIGUITY_CASES_V1,
  SITEFORGE_VERTICAL_MATRIX_V1,
} from '@/fixtures/siteforge-vertical-matrix.v1'
import { ACF_BLOCK_TYPES } from '@/types/siteforge'
import {
  VERTICAL_CONVERSION_INTENTS,
  VERTICAL_POLICY_CODES,
  composedVerticalManifestSchema,
  verticalPackSchema,
} from './contracts'
import {
  VerticalCompositionError,
  composeVerticalPacks,
} from './composition'
import {
  SITEFORGE_VERTICAL_PACKS,
  VERTICAL_REGISTRY_VERSION,
  VerticalPackRegistry,
  siteForgeVerticalRegistry,
  type RegisteredVerticalPack,
} from './registry'

function packDefinition(pack: RegisteredVerticalPack) {
  const definition: Partial<RegisteredVerticalPack> = { ...pack }
  delete definition.contentHash
  return definition
}

describe('SiteForge vertical pack registry', () => {
  it('registers strict, versioned packs with deterministic content hashes', () => {
    const first = new VerticalPackRegistry(
      VERTICAL_REGISTRY_VERSION,
      SITEFORGE_VERTICAL_PACKS
    )
    const second = new VerticalPackRegistry(
      VERTICAL_REGISTRY_VERSION,
      SITEFORGE_VERTICAL_PACKS
    )

    expect(first.list()).toHaveLength(SITEFORGE_VERTICAL_PACKS.length)
    expect(first.list().map(pack => pack.contentHash)).toEqual(
      second.list().map(pack => pack.contentHash)
    )
    for (const pack of first.list()) {
      expect(verticalPackSchema.parse(packDefinition(pack))).toBeTruthy()
      expect(pack.contentHash).toMatch(/^[a-f0-9]{64}$/)
      expect(pack.applicability.scopes.length).toBeGreaterThan(0)
      expect(pack.applicability.sectors.length).toBeGreaterThan(0)
      expect(pack.applicability.transactions.length).toBeGreaterThan(0)
      expect(pack.applicability.archetypes.length).toBeGreaterThan(0)
      expect(pack.applicability.lifecycles.length).toBeGreaterThan(0)
      expect(pack.requiredEvidence).toBeDefined()
      expect(pack.optionalEvidence).toBeDefined()
      expect(pack.decisionIds).toBeDefined()
      expect(pack.questionIds).toBeDefined()
      expect(pack.pages).toBeDefined()
      expect(pack.offeringKinds).toBeDefined()
      expect(pack.conversionIntentRecipes).toBeDefined()
      expect(pack.seoSchemaTypes).toBeDefined()
      expect(pack.policyCodes).toBeDefined()
      expect(pack.forbiddenClaims).toBeDefined()
      expect(pack.analyticsOutcomes).toBeDefined()
      expect(pack.freshnessRules).toBeDefined()
      expect(pack.lifecycleOverrides).toBeDefined()
    }
  })

  it('rejects duplicate pack identities and ambiguous selectors', () => {
    const core = SITEFORGE_VERTICAL_PACKS[0]

    expect(
      () =>
        new VerticalPackRegistry(VERTICAL_REGISTRY_VERSION, [core, core])
    ).toThrow('DUPLICATE_PACK_IDENTITY')
    expect(
      () =>
        new VerticalPackRegistry(VERTICAL_REGISTRY_VERSION, [
          core,
          {
            ...core,
            key: 'siteforge.vertical.core.duplicate',
          },
        ])
    ).toThrow('AMBIGUOUS_PACK_SELECTOR')
  })

  it('covers every registered pack with at least one matrix fixture', () => {
    const coveredKeys = new Set(
      SITEFORGE_VERTICAL_MATRIX_V1.flatMap(item => item.expectedPackKeys)
    )
    const missing = siteForgeVerticalRegistry
      .list()
      .map(pack => pack.key)
      .filter(key => !coveredKeys.has(key))

    expect(SITEFORGE_VERTICAL_MATRIX_V1).toHaveLength(26)
    expect(missing).toEqual([])
  })

  it('uses only typed block, conversion, and policy keys', () => {
    const blockKeys = new Set(ACF_BLOCK_TYPES)
    const conversionKeys = new Set(VERTICAL_CONVERSION_INTENTS)
    const policyKeys = new Set(VERTICAL_POLICY_CODES)

    for (const pack of siteForgeVerticalRegistry.list()) {
      for (const page of pack.pages) {
        for (const section of page.sections) {
          expect(blockKeys.has(section.blockKey)).toBe(true)
          if (section.conversionIntent) {
            expect(conversionKeys.has(section.conversionIntent)).toBe(true)
          }
        }
      }
      for (const recipe of pack.conversionIntentRecipes) {
        expect(conversionKeys.has(recipe.intent)).toBe(true)
        if (recipe.fallbackIntent) {
          expect(conversionKeys.has(recipe.fallbackIntent)).toBe(true)
        }
      }
      for (const policyCode of pack.policyCodes) {
        expect(policyKeys.has(policyCode)).toBe(true)
      }
    }
  })

  it('adds for-sale conversion and freshness lanes without changing multifamily', () => {
    const forSale = siteForgeVerticalRegistry.get(
      'archetype',
      'for_sale_community'
    )
    const multifamily = siteForgeVerticalRegistry.get(
      'archetype',
      'rental_multifamily'
    )

    expect(forSale.conversionIntentRecipes.map(recipe => recipe.intent)).toEqual(
      expect.arrayContaining([
        'sales_inquiry',
        'register_interest',
        'visit',
        'brochure_request',
        'broker_registration',
      ])
    )
    expect(forSale.freshnessRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ evidenceKind: 'pricing', maxAgeHours: 24 }),
        expect.objectContaining({
          evidenceKind: 'availability',
          maxAgeHours: 24,
        }),
        expect.objectContaining({
          evidenceKind: 'construction_status',
          maxAgeHours: 168,
        }),
      ])
    )
    expect(multifamily.offeringKinds).toEqual(['rental_unit'])
    expect(multifamily.conversionIntentRecipes).toHaveLength(1)
  })
})

describe('SiteForge vertical pack composition', () => {
  it.each(SITEFORGE_VERTICAL_MATRIX_V1)(
    'composes $id without a fallback',
    matrix => {
      const manifest = composeVerticalPacks(matrix.request)

      expect(manifest.packs.map(pack => pack.key)).toEqual(
        matrix.expectedPackKeys
      )
      expect(manifest.offeringKinds).toContain(matrix.expectedOfferingKind)
      expect(
        manifest.conversionIntentRecipes.some(
          recipe => recipe.intent === matrix.expectedPrimaryIntent
        )
      ).toBe(true)
      expect(composedVerticalManifestSchema.parse(manifest)).toEqual(manifest)
      expect(manifest.contentHash).toMatch(/^[a-f0-9]{64}$/)
    }
  )

  it('always composes core through lifecycle in canonical order', () => {
    for (const matrix of SITEFORGE_VERTICAL_MATRIX_V1) {
      const layers = composeVerticalPacks(matrix.request).packs.map(
        pack => pack.layer
      )
      const modifierStart = layers.indexOf('modifier')
      expect(layers.slice(0, 5)).toEqual([
        'core',
        'scope',
        'sector',
        'transaction',
        'archetype',
      ])
      expect(layers.at(-1)).toBe('lifecycle')
      if (modifierStart >= 0) {
        expect(
          layers.slice(modifierStart, layers.length - 1).every(
            layer => layer === 'modifier'
          )
        ).toBe(true)
      }
    }
  })

  it('sorts modifiers before hashing and returns a canonical manifest', () => {
    const request = {
      registryVersion: VERTICAL_REGISTRY_VERSION,
      scope: 'community' as const,
      sector: 'residential' as const,
      transaction: 'rental' as const,
      archetype: 'rental_multifamily',
      modifiers: ['student', 'lease_up'],
      lifecycle: 'lease_up' as const,
      confirmedOverride: null,
    }
    const reversed = {
      ...request,
      modifiers: [...request.modifiers].reverse(),
    }

    const first = composeVerticalPacks(request)
    const second = composeVerticalPacks(reversed)
    expect(first).toEqual(second)
    expect(first.selection.modifiers).toEqual(['lease_up', 'student'])
  })

  it('appends a confirmed override last without replacing declarations', () => {
    const base = verticalPackSchema.parse(
      packDefinition(siteForgeVerticalRegistry.get('modifier', 'luxury'))
    )
    const override = {
      ...base,
      key: 'siteforge.vertical.confirmed_override.operator',
      layer: 'confirmed_override' as const,
      selector: 'operator',
      exclusiveClaims: [],
      conflictsWith: [],
    }
    const request = {
      ...SITEFORGE_VERTICAL_MATRIX_V1[0].request,
      confirmedOverride: override,
    }

    const manifest = composeVerticalPacks(request)
    expect(manifest.packs.at(-1)).toMatchObject({
      key: override.key,
      layer: 'confirmed_override',
    })
    expect(manifest.packs.at(-2)?.layer).toBe('lifecycle')
  })

  it('rejects duplicate declarations instead of applying last-writer-wins', () => {
    const core = verticalPackSchema.parse(
      packDefinition(siteForgeVerticalRegistry.get('core', 'real_estate'))
    )
    const override = {
      ...core,
      key: 'siteforge.vertical.confirmed_override.duplicate',
      layer: 'confirmed_override' as const,
      selector: 'duplicate',
      exclusiveClaims: [],
      conflictsWith: [],
    }

    expect(() =>
      composeVerticalPacks({
        ...SITEFORGE_VERTICAL_MATRIX_V1[0].request,
        confirmedOverride: override,
      })
    ).toThrow('DUPLICATE_DECLARATION')
  })

  it.each(
    SITEFORGE_VERTICAL_AMBIGUITY_CASES_V1.filter(
      fixture => fixture.kind === 'composition'
    )
  )('fails closed for $id', fixture => {
    if (fixture.kind !== 'composition') return
    expect(() => composeVerticalPacks(fixture.request)).toThrow(
      fixture.expectedError
    )
  })

  it('returns structured conflict details', () => {
    try {
      composeVerticalPacks({
        registryVersion: VERTICAL_REGISTRY_VERSION,
        scope: 'community',
        sector: 'residential',
        transaction: 'rental',
        archetype: 'rental_multifamily',
        modifiers: ['affordable', 'luxury'],
        lifecycle: 'operating',
        confirmedOverride: null,
      })
      throw new Error('Expected composition to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(VerticalCompositionError)
      expect((error as VerticalCompositionError).code).toBe('PACK_CONFLICT')
    }
  })

  it('rejects duplicate modifier selectors explicitly', () => {
    expect(() =>
      composeVerticalPacks({
        ...SITEFORGE_VERTICAL_MATRIX_V1[0].request,
        modifiers: ['student', 'student'],
      })
    ).toThrow('DUPLICATE_MODIFIER')
  })
})
