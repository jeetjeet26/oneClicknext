import { z } from 'zod'
import {
  VERTICAL_CONVERSION_INTENTS,
  verticalAnalyticsOutcomeSchema,
  verticalConversionIntentSchema,
} from '@/utils/siteforge/verticals/contracts'

export const conversionSensitivitySchema = z.enum(['none', 'contact', 'regulated'])
export const conversionConsentRequirementSchema = z.enum([
  'none',
  'privacy_notice',
  'explicit',
])

export const conversionIntentDefinitionSchema = z
  .object({
    intent: verticalConversionIntentSchema,
    allowedFields: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)),
    requiredFields: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)),
    sensitivity: conversionSensitivitySchema,
    consentRequirement: conversionConsentRequirementSchema,
    providerCapability: z.enum([
      'lead_capture',
      'tour_scheduler',
      'application_redirect',
      'external_redirect',
    ]),
    successEvent: verticalAnalyticsOutcomeSchema,
    offlineOutcome: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/).nullable(),
    fallbackIntent: verticalConversionIntentSchema.nullable(),
  })
  .strict()

export type ConversionIntentDefinition = z.infer<
  typeof conversionIntentDefinitionSchema
>

export const forSaleConversionLaneSchema = z.enum([
  'registration',
  'sales_inquiry',
  'appointment',
  'brochure_download',
  'plan_save',
  'home_save',
  'broker_handoff',
])

export const FOR_SALE_CONVERSION_LANES = Object.freeze({
  registration: {
    intent: 'register_interest',
    onlineOutcome: 'registration_completed',
    offlineOutcome: 'registration_qualified',
  },
  sales_inquiry: {
    intent: 'sales_inquiry',
    onlineOutcome: 'sales_lead_created',
    offlineOutcome: 'sale_closed',
  },
  appointment: {
    intent: 'visit',
    onlineOutcome: 'appointment_scheduled',
    offlineOutcome: 'visit_completed',
  },
  brochure_download: {
    intent: 'brochure_request',
    onlineOutcome: 'brochure_downloaded',
    offlineOutcome: 'brochure_follow_up',
  },
  plan_save: {
    intent: 'register_interest',
    onlineOutcome: 'plan_saved',
    offlineOutcome: 'saved_plan_follow_up',
  },
  home_save: {
    intent: 'register_interest',
    onlineOutcome: 'home_saved',
    offlineOutcome: 'saved_home_follow_up',
  },
  broker_handoff: {
    intent: 'broker_registration',
    onlineOutcome: 'broker_handoff_requested',
    offlineOutcome: 'broker_handoff_completed',
  },
} as const satisfies Record<
  z.infer<typeof forSaleConversionLaneSchema>,
  {
    intent: z.infer<typeof verticalConversionIntentSchema>
    onlineOutcome: string
    offlineOutcome: string
  }
>)

const contactFields = ['first_name', 'last_name', 'email', 'phone', 'message']
const optionalContextFields = ['preferred_date', 'preferred_time', 'offering_id']

function definition(
  value: ConversionIntentDefinition
): ConversionIntentDefinition {
  return conversionIntentDefinitionSchema.parse(value)
}

export const SITEFORGE_CONVERSION_INTENTS = Object.freeze({
  inquiry: definition({
    intent: 'inquiry',
    allowedFields: [...contactFields, 'company', 'request_type'],
    requiredFields: ['email'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'lead_capture',
    successEvent: 'qualified_inquiry',
    offlineOutcome: 'lead_qualified',
    fallbackIntent: null,
  }),
  tour: definition({
    intent: 'tour',
    allowedFields: [...contactFields, ...optionalContextFields, 'tour_type'],
    requiredFields: ['email', 'preferred_date', 'preferred_time'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'tour_scheduler',
    successEvent: 'tour_scheduled',
    offlineOutcome: 'tour_completed',
    fallbackIntent: 'inquiry',
  }),
  visit: definition({
    intent: 'visit',
    allowedFields: [...contactFields, ...optionalContextFields],
    requiredFields: ['email'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'lead_capture',
    successEvent: 'appointment_scheduled',
    offlineOutcome: 'visit_completed',
    fallbackIntent: 'inquiry',
  }),
  private_appointment: definition({
    intent: 'private_appointment',
    allowedFields: [...contactFields, ...optionalContextFields],
    requiredFields: ['email'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'lead_capture',
    successEvent: 'appointment_scheduled',
    offlineOutcome: 'appointment_completed',
    fallbackIntent: 'inquiry',
  }),
  apply: definition({
    intent: 'apply',
    allowedFields: ['offering_id'],
    requiredFields: [],
    sensitivity: 'none',
    consentRequirement: 'privacy_notice',
    providerCapability: 'application_redirect',
    successEvent: 'application_started',
    offlineOutcome: 'application_completed',
    fallbackIntent: 'inquiry',
  }),
  register_interest: definition({
    intent: 'register_interest',
    allowedFields: [...contactFields, 'offering_id'],
    requiredFields: ['email'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'lead_capture',
    successEvent: 'registration_completed',
    offlineOutcome: 'registration_qualified',
    fallbackIntent: 'inquiry',
  }),
  waitlist: definition({
    intent: 'waitlist',
    allowedFields: [...contactFields, 'offering_id'],
    requiredFields: ['email'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'lead_capture',
    successEvent: 'waitlist_joined',
    offlineOutcome: 'waitlist_advanced',
    fallbackIntent: 'inquiry',
  }),
  pricing_availability_request: definition({
    intent: 'pricing_availability_request',
    allowedFields: [...contactFields, 'offering_id'],
    requiredFields: ['email'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'lead_capture',
    successEvent: 'qualified_inquiry',
    offlineOutcome: 'pricing_request_qualified',
    fallbackIntent: 'inquiry',
  }),
  brochure_request: definition({
    intent: 'brochure_request',
    allowedFields: [...contactFields, 'offering_id'],
    requiredFields: ['email'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'lead_capture',
    successEvent: 'brochure_requested',
    offlineOutcome: 'brochure_follow_up',
    fallbackIntent: 'inquiry',
  }),
  broker_registration: definition({
    intent: 'broker_registration',
    allowedFields: [...contactFields, 'company', 'license_number', 'offering_id'],
    requiredFields: ['email', 'company'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'lead_capture',
    successEvent: 'broker_registered',
    offlineOutcome: 'broker_registration_approved',
    fallbackIntent: 'sales_inquiry',
  }),
  sales_inquiry: definition({
    intent: 'sales_inquiry',
    allowedFields: [...contactFields, 'offering_id', 'company'],
    requiredFields: ['email'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'lead_capture',
    successEvent: 'sales_lead_created',
    offlineOutcome: 'sale_closed',
    fallbackIntent: 'inquiry',
  }),
  commercial_leasing_inquiry: definition({
    intent: 'commercial_leasing_inquiry',
    allowedFields: [...contactFields, 'company', 'space_need', 'offering_id'],
    requiredFields: ['email', 'company'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'lead_capture',
    successEvent: 'leasing_lead_created',
    offlineOutcome: 'lease_executed',
    fallbackIntent: 'inquiry',
  }),
  rfp: definition({
    intent: 'rfp',
    allowedFields: [...contactFields, 'company', 'event_date', 'guest_count'],
    requiredFields: ['email', 'company'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'lead_capture',
    successEvent: 'rfp_submitted',
    offlineOutcome: 'rfp_won',
    fallbackIntent: 'inquiry',
  }),
  professional_referral: definition({
    intent: 'professional_referral',
    allowedFields: [
      ...contactFields,
      'company',
      'professional_role',
      'preferred_contact_method',
    ],
    requiredFields: ['email', 'professional_role'],
    sensitivity: 'contact',
    consentRequirement: 'explicit',
    providerCapability: 'lead_capture',
    successEvent: 'professional_referral_submitted',
    offlineOutcome: 'referral_accepted',
    fallbackIntent: 'inquiry',
  }),
  directions: definition({
    intent: 'directions',
    allowedFields: [],
    requiredFields: [],
    sensitivity: 'none',
    consentRequirement: 'none',
    providerCapability: 'external_redirect',
    successEvent: 'directions_requested',
    offlineOutcome: null,
    fallbackIntent: null,
  }),
  external_booking: definition({
    intent: 'external_booking',
    allowedFields: ['offering_id'],
    requiredFields: [],
    sensitivity: 'none',
    consentRequirement: 'privacy_notice',
    providerCapability: 'external_redirect',
    successEvent: 'booking_started',
    offlineOutcome: 'booking_completed',
    fallbackIntent: 'inquiry',
  }),
} satisfies Record<
  (typeof VERTICAL_CONVERSION_INTENTS)[number],
  ConversionIntentDefinition
>)

const prohibitedSensitiveField =
  /(?:diagnos|medicat|medical|health|disab|ssn|social_security|credit|income|financial|insurance|eligibility)/

export function validateConversionCustomFields(
  intent: keyof typeof SITEFORGE_CONVERSION_INTENTS,
  raw: unknown
): Record<string, string> {
  const fields = z.record(
    z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    z.string().trim().max(2_000)
  ).parse(raw || {})
  const contract = SITEFORGE_CONVERSION_INTENTS[intent]
  for (const [key, value] of Object.entries(fields)) {
    if (prohibitedSensitiveField.test(key)) {
      throw new Error(`Sensitive conversion field is prohibited: ${key}`)
    }
    if (!contract.allowedFields.includes(key)) {
      throw new Error(`Field is not allowed for ${intent}: ${key}`)
    }
    if (!value && contract.requiredFields.includes(key)) {
      throw new Error(`Field is required for ${intent}: ${key}`)
    }
  }
  return fields
}
