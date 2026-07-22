import { describe, expect, it } from 'vitest'
import { checkResponseText, evaluateReviewPolicy } from './policy'
import { SENSITIVE_POLICY_CLASSES } from './taxonomy'

describe('evaluateReviewPolicy', () => {
  it('returns standard handling for a routine positive review', () => {
    const result = evaluateReviewPolicy({
      reviewText: 'Love living here! The pool is great and the team is friendly.',
      modelConfidence: 0.95,
    })

    expect(result.policyClass).toBe('standard')
    expect(result.flags).toHaveLength(0)
    expect(result.requiresHumanReview).toBe(false)
    expect(result.autoActionEligible).toBe(true)
  })

  const sensitiveFixtures: Array<{ name: string; text: string; expectedClass: string }> = [
    {
      name: 'fair housing / protected class language',
      text: 'They denied my application because of my housing voucher and section 8 status.',
      expectedClass: 'fair_housing',
    },
    {
      name: 'discrimination claim',
      text: 'The leasing office discriminated against us from day one.',
      expectedClass: 'discrimination',
    },
    {
      name: 'accessibility accommodation',
      text: 'They refused my service animal even though I have documentation.',
      expectedClass: 'accessibility',
    },
    {
      name: 'safety incident',
      text: 'There was a break-in on our floor last week and management said nothing.',
      expectedClass: 'safety',
    },
    {
      name: 'legal threat',
      text: 'I am contacting my attorney and filing a lawsuit over this.',
      expectedClass: 'legal_threat',
    },
    {
      name: 'habitability condition',
      text: 'We have had mold in the bathroom and no hot water for two weeks.',
      expectedClass: 'habitability',
    },
    {
      name: 'employee accusation',
      text: 'The manager lied to us repeatedly about the move-in date.',
      expectedClass: 'employee_accusation',
    },
    {
      name: 'compensation demand',
      text: 'They withheld my deposit and I want a refund immediately.',
      expectedClass: 'compensation_liability',
    },
  ]

  for (const fixture of sensitiveFixtures) {
    it(`flags ${fixture.name} and requires human review`, () => {
      const result = evaluateReviewPolicy({ reviewText: fixture.text, modelConfidence: 0.9 })

      expect(result.flags.length).toBeGreaterThan(0)
      expect(SENSITIVE_POLICY_CLASSES.has(result.policyClass)).toBe(true)
      // Sensitive classes must never be auto-action eligible.
      expect(result.requiresHumanReview).toBe(true)
      expect(result.autoActionEligible).toBe(false)
    })
  }

  it('escalates to the most severe class when multiple rules match', () => {
    const result = evaluateReviewPolicy({
      reviewText:
        'The manager lied about the mold, they discriminated against us, and I want a refund.',
      modelConfidence: 0.9,
    })

    // discrimination outranks habitability, employee_accusation, and compensation.
    expect(result.policyClass).toBe('discrimination')
    expect(result.flags.length).toBeGreaterThanOrEqual(3)
  })

  it('lets the model escalate but never downgrade the deterministic class', () => {
    const escalated = evaluateReviewPolicy({
      reviewText: 'Nice place overall.',
      modelPolicyClass: 'safety',
      modelConfidence: 0.9,
    })
    expect(escalated.policyClass).toBe('safety')
    expect(escalated.requiresHumanReview).toBe(true)

    const notDowngraded = evaluateReviewPolicy({
      reviewText: 'I am suing this place, talking to my lawyer today.',
      modelPolicyClass: 'standard',
      modelConfidence: 0.9,
    })
    expect(notDowngraded.policyClass).toBe('legal_threat')
    expect(notDowngraded.requiresHumanReview).toBe(true)
  })

  it('requires human review when model confidence is low', () => {
    const result = evaluateReviewPolicy({
      reviewText: 'Just fine, nothing special.',
      modelConfidence: 0.4,
    })

    expect(result.policyClass).toBe('standard')
    expect(result.requiresHumanReview).toBe(true)
    expect(result.autoActionEligible).toBe(false)
  })

  it('requires human review for legal_regulatory risk class', () => {
    const result = evaluateReviewPolicy({
      reviewText: 'Everything is fine.',
      modelConfidence: 0.9,
      riskClass: 'legal_regulatory',
    })

    expect(result.requiresHumanReview).toBe(true)
  })

  it('flags privacy exposure like unit numbers and phone numbers', () => {
    const result = evaluateReviewPolicy({
      reviewText: 'I live in unit 204 and my number is 512-555-1234, call me.',
      modelConfidence: 0.9,
    })

    expect(result.flags.some((flag) => flag.policyClass === 'privacy')).toBe(true)
    expect(result.requiresHumanReview).toBe(true)
  })
})

describe('checkResponseText', () => {
  it('passes a grounded, professional response', () => {
    const result = checkResponseText(
      'Thank you for your feedback. We take maintenance concerns seriously — ' +
        'please contact our office so we can help directly.'
    )
    expect(result.passed).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('rejects unsupported financial promises', () => {
    const result = checkResponseText('We will refund your deposit in full, guaranteed.')
    expect(result.passed).toBe(false)
    expect(result.violations.some((v) => v.rule === 'unsupported_promise')).toBe(true)
  })

  it('rejects resident account disclosures', () => {
    const result = checkResponseText('Our records show your lease ended in March with a balance.')
    expect(result.passed).toBe(false)
    expect(result.violations.some((v) => v.rule === 'resident_disclosure')).toBe(true)
  })

  it('rejects identity inference', () => {
    const result = checkResponseText('We know who you are and will follow up on your file.')
    expect(result.passed).toBe(false)
    expect(result.violations.some((v) => v.rule === 'identity_inference')).toBe(true)
  })
})
