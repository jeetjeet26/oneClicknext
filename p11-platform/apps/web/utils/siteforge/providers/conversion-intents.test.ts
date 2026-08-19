import { describe, expect, it } from 'vitest'
import { siteForgePublicConversionSchema } from './conversions'
import {
  FOR_SALE_CONVERSION_LANES,
  SITEFORGE_CONVERSION_INTENTS,
  validateConversionCustomFields,
} from './conversion-intents'
import { VERTICAL_CONVERSION_INTENTS } from '@/utils/siteforge/verticals/contracts'

describe('SiteForge generic conversion intents', () => {
  it('defines every canonical vertical conversion intent exactly once', () => {
    expect(Object.keys(SITEFORGE_CONVERSION_INTENTS).sort()).toEqual(
      [...VERTICAL_CONVERSION_INTENTS].sort()
    )
  })

  it('rejects health and financial qualification fields for every intent', () => {
    expect(() =>
      validateConversionCustomFields('professional_referral', {
        medical_diagnosis: 'Do not collect this',
      })
    ).toThrow('Sensitive conversion field is prohibited')
    expect(() =>
      validateConversionCustomFields('sales_inquiry', {
        financial_qualification: 'Do not collect this',
      })
    ).toThrow('Sensitive conversion field is prohibited')
  })

  it('accepts only declared fields for an intent', () => {
    expect(
      validateConversionCustomFields('commercial_leasing_inquiry', {
        company: 'P11',
        space_need: '10,000 square feet',
      })
    ).toEqual({
      company: 'P11',
      space_need: '10,000 square feet',
    })
    expect(() =>
      validateConversionCustomFields('commercial_leasing_inquiry', {
        guest_count: '200',
      })
    ).toThrow('Field is not allowed')
  })

  it('keeps contact intents consent-gated while allowing redirect intents', () => {
    expect(() =>
      siteForgePublicConversionSchema.parse({
        submission_id: 'submission-contact',
        intent: 'inquiry',
        email: 'person@example.com',
      })
    ).toThrow()

    expect(
      siteForgePublicConversionSchema.parse({
        submission_id: 'submission-booking',
        intent: 'external_booking',
        offering_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }).intent
    ).toBe('external_booking')
  })

  it('maps each for-sale lane to a distinct online and offline outcome', () => {
    expect(FOR_SALE_CONVERSION_LANES).toEqual({
      registration: expect.objectContaining({
        onlineOutcome: 'registration_completed',
      }),
      sales_inquiry: expect.objectContaining({
        onlineOutcome: 'sales_lead_created',
      }),
      appointment: expect.objectContaining({
        onlineOutcome: 'appointment_scheduled',
      }),
      brochure_download: expect.objectContaining({
        onlineOutcome: 'brochure_downloaded',
      }),
      plan_save: expect.objectContaining({ onlineOutcome: 'plan_saved' }),
      home_save: expect.objectContaining({ onlineOutcome: 'home_saved' }),
      broker_handoff: expect.objectContaining({
        onlineOutcome: 'broker_handoff_requested',
        offlineOutcome: 'broker_handoff_completed',
      }),
    })
  })
})
