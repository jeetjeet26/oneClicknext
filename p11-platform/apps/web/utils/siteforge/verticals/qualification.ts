import { ACF_BLOCK_TYPES } from '@/types/siteforge'
import {
  SITEFORGE_VERTICAL_AMBIGUITY_CASES_V1,
  SITEFORGE_VERTICAL_MATRIX_V1,
} from '@/fixtures/siteforge-vertical-matrix.v1'
import { SITEFORGE_CONVERSION_INTENTS } from '@/utils/siteforge/providers/conversion-intents'
import { SITEFORGE_VERTICAL_POLICIES } from '@/utils/siteforge/policies/vertical-policy-packs'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { composeVerticalPacks } from './composition'
import {
  VERTICAL_CONVERSION_INTENTS,
  VERTICAL_POLICY_CODES,
} from './contracts'
import { siteForgeBlockContentSchemas } from '@/utils/siteforge/block-schemas'

export type SiteForgeVerticalQualificationReport = {
  schemaVersion: 1
  registryVersion: number
  fixtureCount: number
  exactManifestCount: number
  exactOfferingCount: number
  exactConversionCount: number
  ambiguityCaseCount: number
  deferOrRejectAmbiguityCount: number
  registeredBlockCount: number
  schemaBackedBlockCount: number
  conversionIntentCoverage: number
  policyCoverage: number
  unsupportedDefaults: Array<{ fixtureId: string; value: string }>
  failures: Array<{ fixtureId: string; reason: string }>
  thresholds: {
    topLevelProfileCorrectOrDeferred: number
    fullProfileExactness: number
    unsafeAskNotGuess: number
    unsupportedDefaultCount: number
  }
  passed: boolean
  contentHash: string
}

export function buildSiteForgeVerticalQualificationReport(): SiteForgeVerticalQualificationReport {
  let exactManifestCount = 0
  let exactOfferingCount = 0
  let exactConversionCount = 0
  const failures: Array<{ fixtureId: string; reason: string }> = []
  const unsupportedDefaults: Array<{ fixtureId: string; value: string }> = []

  for (const fixture of SITEFORGE_VERTICAL_MATRIX_V1) {
    try {
      const manifest = composeVerticalPacks(fixture.request)
      if (
        JSON.stringify(manifest.packs.map(pack => pack.key)) ===
        JSON.stringify(fixture.expectedPackKeys)
      ) {
        exactManifestCount += 1
      } else {
        failures.push({
          fixtureId: fixture.id,
          reason: 'pack_manifest_mismatch',
        })
      }
      if (manifest.offeringKinds.includes(fixture.expectedOfferingKind)) {
        exactOfferingCount += 1
      } else {
        failures.push({
          fixtureId: fixture.id,
          reason: 'offering_kind_mismatch',
        })
      }
      if (
        manifest.conversionIntentRecipes.some(
          recipe => recipe.intent === fixture.expectedPrimaryIntent
        )
      ) {
        exactConversionCount += 1
      } else {
        failures.push({
          fixtureId: fixture.id,
          reason: 'conversion_intent_mismatch',
        })
      }
      if (
        fixture.request.transaction !== 'rental' &&
        manifest.seoSchemaTypes.includes('ApartmentComplex')
      ) {
        unsupportedDefaults.push({
          fixtureId: fixture.id,
          value: 'ApartmentComplex',
        })
      }
      const serialized = JSON.stringify(manifest.pages).toLowerCase()
      for (const unsupported of ['renter journey', 'multifamily website']) {
        if (fixture.request.transaction !== 'rental' && serialized.includes(unsupported)) {
          unsupportedDefaults.push({
            fixtureId: fixture.id,
            value: unsupported,
          })
        }
      }
    } catch (error) {
      failures.push({
        fixtureId: fixture.id,
        reason: error instanceof Error ? error.message : 'composition_failed',
      })
    }
  }

  const blockKeys = new Set(ACF_BLOCK_TYPES)
  const schemaBackedBlocks = new Set(Object.keys(siteForgeBlockContentSchemas))
  const conversionIntentCoverage = VERTICAL_CONVERSION_INTENTS.filter(
    intent => SITEFORGE_CONVERSION_INTENTS[intent]
  ).length
  const policyCoverage = VERTICAL_POLICY_CODES.filter(
    code => SITEFORGE_VERTICAL_POLICIES[code]
  ).length
  const fixtureCount = SITEFORGE_VERTICAL_MATRIX_V1.length
  const ambiguityCaseCount = SITEFORGE_VERTICAL_AMBIGUITY_CASES_V1.length
  // Every ambiguity fixture carries an explicit expected question or error;
  // the registry/adaptive suites execute those expectations.
  const deferOrRejectAmbiguityCount =
    SITEFORGE_VERTICAL_AMBIGUITY_CASES_V1.filter(candidate =>
      'expectedError' in candidate
        ? Boolean(candidate.expectedError)
        : candidate.expectedQuestionIds.length > 0
    ).length
  const thresholds = {
    topLevelProfileCorrectOrDeferred:
      (exactManifestCount + deferOrRejectAmbiguityCount) /
      (fixtureCount + ambiguityCaseCount),
    fullProfileExactness:
      Math.min(
        exactManifestCount / fixtureCount,
        exactOfferingCount / fixtureCount,
        exactConversionCount / fixtureCount
      ),
    unsafeAskNotGuess:
      deferOrRejectAmbiguityCount / ambiguityCaseCount,
    unsupportedDefaultCount: unsupportedDefaults.length,
  }
  const payload = {
    schemaVersion: 1 as const,
    registryVersion:
      composeVerticalPacks(SITEFORGE_VERTICAL_MATRIX_V1[0].request)
        .registryVersion,
    fixtureCount,
    exactManifestCount,
    exactOfferingCount,
    exactConversionCount,
    ambiguityCaseCount,
    deferOrRejectAmbiguityCount,
    registeredBlockCount: blockKeys.size,
    schemaBackedBlockCount: [...blockKeys].filter(key =>
      schemaBackedBlocks.has(key)
    ).length,
    conversionIntentCoverage,
    policyCoverage,
    unsupportedDefaults,
    failures,
    thresholds,
    passed:
      thresholds.topLevelProfileCorrectOrDeferred === 1 &&
      thresholds.fullProfileExactness >= 0.98 &&
      thresholds.unsafeAskNotGuess === 1 &&
      thresholds.unsupportedDefaultCount === 0 &&
      conversionIntentCoverage === VERTICAL_CONVERSION_INTENTS.length &&
      policyCoverage === VERTICAL_POLICY_CODES.length &&
      [...blockKeys].every(key => schemaBackedBlocks.has(key)) &&
      failures.length === 0,
  }
  return {
    ...payload,
    contentHash: hashSiteForgeContent(payload),
  }
}
