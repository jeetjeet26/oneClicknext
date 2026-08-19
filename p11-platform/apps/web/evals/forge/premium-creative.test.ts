import { describe, expect, it } from 'vitest'
import { SITEFORGE_PREMIUM_CREATIVE_CASES_V1 } from '../../fixtures/siteforge-premium-creative.v1'
import {
  PREMIUM_CREATIVE_EVALUATOR_VERSION,
  PREMIUM_CREATIVE_RUBRIC_VERSION,
  normalizeMultimodalCriticInput,
  premiumCreativeMetricIds,
} from './contracts'
import { evaluatePremiumCreative } from './evaluate'
import { findRepeatedCopy, jaccardCopySimilarity } from './similarity'

describe('SiteForge premium creative evaluation suite', () => {
  it('covers paired target verticals', () => {
    expect(
      SITEFORGE_PREMIUM_CREATIVE_CASES_V1.map(testCase =>
        testCase.premium.vertical
      )
    ).toEqual([
      'multifamily',
      'lease_up',
      'for_sale',
      'master_planned',
      'homebuilder',
    ])
    for (const testCase of SITEFORGE_PREMIUM_CREATIVE_CASES_V1) {
      expect(testCase.premium.pairId).toBe(testCase.bland.pairId)
      expect(testCase.premium.vertical).toBe(testCase.bland.vertical)
    }
  })

  it.each(SITEFORGE_PREMIUM_CREATIVE_CASES_V1)(
    'passes premium and rejects technically valid bland fixture $pairId',
    testCase => {
      const premium = evaluatePremiumCreative(testCase.premium)
      const bland = evaluatePremiumCreative(testCase.bland)

      expect(premium.passed).toBe(true)
      expect(bland.passed).toBe(false)
      expect(premium.normalizedScore).toBeGreaterThan(bland.normalizedScore)
      expect(bland.findings.map(finding => finding.code)).toEqual(
        expect.arrayContaining([
          'LAYOUT_RHYTHM_REPEATS',
          'GENERIC_LANGUAGE_HIGH',
          'REPEATED_COPY_SIMILARITY',
        ])
      )
      expect(bland.findings.some(finding => finding.severity === 'blocker')).toBe(
        true
      )
    }
  )

  it('emits normalized, versioned score and finding contracts', () => {
    const result = evaluatePremiumCreative(
      SITEFORGE_PREMIUM_CREATIVE_CASES_V1[0].bland
    )

    expect(result).toMatchObject({
      schemaVersion: 1,
      evaluatorVersion: PREMIUM_CREATIVE_EVALUATOR_VERSION,
      rubricVersion: PREMIUM_CREATIVE_RUBRIC_VERSION,
      model: {
        provider: 'local',
        model: 'deterministic',
        version: 'heuristics-1',
      },
    })
    expect(result.metrics.map(metric => metric.metric)).toEqual(
      premiumCreativeMetricIds
    )
    expect(
      result.metrics.every(metric => metric.score >= 0 && metric.score <= 1)
    ).toBe(true)
    expect(
      result.findings.every(
        finding =>
          finding.score >= 0 &&
          finding.score <= 1 &&
          finding.locations.length > 0
      )
    ).toBe(true)
  })

  it('normalizes future multimodal critic scores without a model call', () => {
    expect(
      normalizeMultimodalCriticInput({
        evaluatorVersion: 'vision-critic-v2',
        modelVersion: 'critic-model-2026-08',
        scores: {
          hierarchy: 1.4,
          mobile_quality: -0.2,
          image_direction: 0.67891,
        },
      }).scores
    ).toEqual({
      hierarchy: 1,
      mobile_quality: 0,
      image_direction: 0.679,
    })
  })

  it('detects repeated copy while preserving distinct section narratives', () => {
    expect(
      jaccardCopySimilarity(
        'Resort-style amenities for your best life.',
        'Resort-style amenities for your best life.'
      )
    ).toBe(1)
    expect(
      findRepeatedCopy(
        SITEFORGE_PREMIUM_CREATIVE_CASES_V1[0].bland.sections
      ).length
    ).toBeGreaterThan(0)
    expect(
      findRepeatedCopy(
        SITEFORGE_PREMIUM_CREATIVE_CASES_V1[0].premium.sections
      )
    ).toEqual([])
  })
})
