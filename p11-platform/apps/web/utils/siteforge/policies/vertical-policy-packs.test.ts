import { describe, expect, it } from 'vitest'
import { SITEFORGE_VERTICAL_MATRIX_V1 } from '@/fixtures/siteforge-vertical-matrix.v1'
import { composeVerticalPacks } from '@/utils/siteforge/verticals/composition'
import { VERTICAL_POLICY_CODES } from '@/utils/siteforge/verticals/contracts'
import {
  SITEFORGE_VERTICAL_POLICIES,
  evaluateVerticalPolicies,
} from './vertical-policy-packs'

function manifest(fixtureId: string) {
  const fixture = SITEFORGE_VERTICAL_MATRIX_V1.find(
    candidate => candidate.id === fixtureId
  )
  if (!fixture) throw new Error(`Missing fixture ${fixtureId}`)
  return composeVerticalPacks(fixture.request)
}

describe('SiteForge vertical policy packs', () => {
  it('defines a non-waivable, explicit AI policy for every policy code', () => {
    expect(Object.keys(SITEFORGE_VERTICAL_POLICIES).sort()).toEqual(
      [...VERTICAL_POLICY_CODES].sort()
    )
    for (const policy of Object.values(SITEFORGE_VERTICAL_POLICIES)) {
      expect(policy.nonWaivable).toBe(true)
      expect(policy.manualChecks.length).toBeGreaterThan(0)
    }
  })

  it('blocks regulated verticals without approved policy and source evidence', () => {
    const result = evaluateVerticalPolicies({
      manifest: manifest('rental.affordable'),
      evidence: [],
      now: new Date('2026-08-13T12:00:00.000Z'),
    })

    expect(result.ready).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyCode: 'affordable_eligibility_waitlist',
          code: 'missing_policy_version',
          nonWaivable: true,
        }),
        expect.objectContaining({
          policyCode: 'affordable_eligibility_waitlist',
          code: 'missing_evidence',
        }),
      ])
    )
  })

  it('blocks prohibited and AI-inferred Fair Housing claims', () => {
    const result = evaluateVerticalPolicies({
      manifest: manifest('rental.conventional_multifamily'),
      evidence: [],
      claims: [
        {
          id: 'claim-1',
          text: 'An exclusive community ideal for young professionals.',
          evidenceIds: [],
          sourceUrl: null,
          sourceRecordId: null,
          asOf: null,
          owner: null,
          confidence: 0.7,
          expiresAt: null,
          approved: false,
          inferredByAi: true,
        },
      ],
    })

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyCode: 'fair_housing',
          code: 'prohibited_claim',
        }),
        expect.objectContaining({
          policyCode: 'fair_housing',
          code: 'ai_inference_prohibited',
        }),
      ])
    )
  })

  it('keeps approved pricing and availability published until replacement', () => {
    const result = evaluateVerticalPolicies({
      manifest: manifest('rental.conventional_multifamily'),
      evidence: [
        {
          id: 'pricing-1',
          kind: 'pricing',
          label: 'Approved pricing snapshot',
          sourceType: 'provider',
          sourceId: 'pricing-provider',
          url: null,
          observedAt: '2026-08-13T11:00:00.000Z',
          freshUntil: '2026-08-13T12:00:00.000Z',
        },
        {
          id: 'availability-1',
          kind: 'availability',
          label: 'Approved availability snapshot',
          sourceType: 'provider',
          sourceId: 'availability-provider',
          url: null,
          observedAt: '2026-08-13T11:00:00.000Z',
          freshUntil: '2026-08-13T12:00:00.000Z',
        },
      ],
      now: new Date('2026-08-13T12:00:00.000Z'),
    })

    expect(result.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyCode: 'pricing_availability',
          code: 'stale_evidence',
        }),
      ])
    )
  })

  it('defines explicit omission and disclosure behavior for for-sale facts', () => {
    expect(SITEFORGE_VERTICAL_POLICIES.pricing_availability).toMatchObject({
      omissionMode: 'omit_unsourced_facts',
      requiredDisclosures: expect.arrayContaining([
        expect.stringContaining('as-of date'),
        expect.stringContaining('until the operator replaces it'),
      ]),
    })
    expect(SITEFORGE_VERTICAL_POLICIES.renderings_construction).toMatchObject({
      omissionMode: 'omit_unsourced_facts',
      requiredDisclosures: expect.arrayContaining([
        expect.stringContaining('artist representations'),
      ]),
    })
    expect(
      SITEFORGE_VERTICAL_POLICIES.financing_brokerage.requiredDisclosures
    ).toEqual([expect.stringContaining('applicable jurisdiction')])
  })
})
