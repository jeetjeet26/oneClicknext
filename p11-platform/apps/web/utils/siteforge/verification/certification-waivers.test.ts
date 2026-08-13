import { describe, expect, it } from 'vitest'
import {
  buildImmutableCertificationWaiver,
  certificationWaiverClass,
  CertificationWaiverError,
  isWaivableCertificationCheck,
  waiverIsActive,
} from './certification-waivers'

const request = {
  propertyId: '11111111-1111-4111-8111-111111111111',
  websiteId: '22222222-2222-4222-8222-222222222222',
  artifactId: '33333333-3333-4333-8333-333333333333',
  checkCode: 'performance.lighthouse_mobile_budget',
  rationale: 'Temporary provider latency is documented for this release.',
  expiresAt: '2026-08-10T00:00:00.000Z',
  evidence: { incident: 'INC-42' },
}

describe('certification waiver policy', () => {
  it('creates a frozen, fingerprinted, expiring waiver', () => {
    const waiver = buildImmutableCertificationWaiver({
      orgId: '44444444-4444-4444-8444-444444444444',
      approvedBy: '55555555-5555-4555-8555-555555555555',
      request,
      now: new Date('2026-07-31T00:00:00.000Z'),
    })

    expect(Object.isFrozen(waiver)).toBe(true)
    expect(waiver.evidence).toEqual(expect.objectContaining({
      immutable: true,
      waiverFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(waiverIsActive(
      { expires_at: waiver.expires_at, revoked_at: null },
      new Date('2026-08-01T00:00:00.000Z')
    )).toBe(true)
  })

  it.each([
    'identity.domain',
    'artifact_manifest_identity',
    'legal.disclosures',
    'rights.asset_license',
    'browser:accessibility.critical_axe',
    'browser:consent.script_blocking',
    'browser:evidence.browser.required',
    'provenance.asset',
  ])('forbids non-waivable check %s', checkCode => {
    expect(isWaivableCertificationCheck(checkCode)).toBe(false)
    expect(() => buildImmutableCertificationWaiver({
      orgId: '44444444-4444-4444-8444-444444444444',
      approvedBy: '55555555-5555-4555-8555-555555555555',
      request: { ...request, checkCode },
      now: new Date('2026-07-31T00:00:00.000Z'),
    })).toThrow(CertificationWaiverError)
  })

  it('classifies only bounded quality findings as manager-waivable', () => {
    expect(
      certificationWaiverClass('performance.lighthouse_mobile_budget')
    ).toBe('manager_waivable')
    expect(certificationWaiverClass('browser:consent.script_blocking')).toBe(
      'non_waivable'
    )
    expect(certificationWaiverClass('rendered_image_provenance')).toBe(
      'non_waivable'
    )
  })

  it('rejects expired and overlong waivers', () => {
    expect(() => buildImmutableCertificationWaiver({
      orgId: '44444444-4444-4444-8444-444444444444',
      approvedBy: '55555555-5555-4555-8555-555555555555',
      request: { ...request, expiresAt: '2026-07-30T00:00:00.000Z' },
      now: new Date('2026-07-31T00:00:00.000Z'),
    })).toThrow('Waiver expiry must be in the future')
    expect(() => buildImmutableCertificationWaiver({
      orgId: '44444444-4444-4444-8444-444444444444',
      approvedBy: '55555555-5555-4555-8555-555555555555',
      request: { ...request, expiresAt: '2026-10-01T00:00:00.000Z' },
      now: new Date('2026-07-31T00:00:00.000Z'),
    })).toThrow('may not exceed 30 days')
  })
})
