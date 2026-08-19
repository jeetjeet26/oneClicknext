import { SITEFORGE_PREMIUM_CREATIVE_CASES_V1 } from '../../fixtures/siteforge-premium-creative.v1'
import { evaluatePremiumCreative } from './evaluate'

const results = SITEFORGE_PREMIUM_CREATIVE_CASES_V1.flatMap(testCase => [
  evaluatePremiumCreative(testCase.premium),
  evaluatePremiumCreative(testCase.bland),
])

const regressions = results.filter(result => {
  const expectedToPass = result.candidateId.endsWith('.premium')
  return result.passed !== expectedToPass
})

process.stdout.write(
  `${JSON.stringify(
    {
      suite: 'siteforge-premium-creative-v1',
      passed: regressions.length === 0,
      cases: results.map(result => ({
        candidateId: result.candidateId,
        vertical: result.vertical,
        passed: result.passed,
        normalizedScore: result.normalizedScore,
        findingCodes: result.findings.map(finding => finding.code),
        evaluatorVersion: result.evaluatorVersion,
        modelVersion: result.model.version,
      })),
    },
    null,
    2
  )}\n`
)

if (regressions.length > 0) process.exitCode = 1
