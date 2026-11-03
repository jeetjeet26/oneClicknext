import { z } from 'zod'

const text = z.string().trim().max(2000)
const short = z.string().trim().max(300)
const reference = z.string().trim().max(2000).refine(value => {
  if (!value) return true
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}, 'Use a complete HTTP or HTTPS address without credentials.')
const email = z.union([z.literal(''), z.email().max(500)])
const date = z.union([z.literal(''), z.iso.date()])
export const SETUP_PRODUCTS = {
  website: 'Website', leads: 'Leads and tours', messaging: 'Property conversations',
  creative: 'Creative and brand', intelligence: 'Property intelligence', reviews: 'Reviews and reputation', reporting: 'Client reporting',
} as const
export const SOURCE_KINDS = {
  website: 'Website', document: 'Document', google_drive: 'Google Drive folder', dropbox: 'Dropbox folder',
  pms: 'PMS or inventory feed', csv: 'Spreadsheet / CSV', manual: 'Reviewed manual entry', brand: 'Brand and image assets',
} as const
export const sourcePlanSchema = z.object({
  id: z.uuid(), kind: z.enum(Object.keys(SOURCE_KINDS) as [keyof typeof SOURCE_KINDS, ...(keyof typeof SOURCE_KINDS)[]]),
  label: short, reference, provider: short, externalId: short, owner: short,
  observedAt: date, reviewAfter: date, visibility: z.enum(['internal', 'portal', 'public']), notes: text,
}).strict().refine(v => !v.observedAt || !v.reviewAfter || v.reviewAfter >= v.observedAt, 'A source review date cannot precede its observation date.')

/** Setup intent is retained with property history. It never grants access or approves source content. */
export const intakeSchema = z.object({
  version: z.literal(1),
  subjectKind: z.enum(['', 'real_estate_property', 'real_estate_development', 'real_estate_portfolio', 'business_location', 'other']),
  scope: z.enum(['', 'property', 'community', 'development', 'corporate', 'portfolio', 'destination']),
  sector: z.enum(['', 'residential', 'senior_care', 'commercial', 'cross_sector', 'destination']),
  transaction: z.enum(['', 'rental', 'for_sale', 'care_services', 'commercial_lease', 'informational', 'destination_booking']),
  lifecycle: z.enum(['', 'operating', 'prelaunch', 'lease_up', 'selling']),
  offeringKind: z.enum(['', 'rental_unit', 'bed_space', 'rental_home', 'home_plan', 'quick_move_in_home', 'homesite', 'care_residence', 'commercial_suite', 'commercial_building', 'land', 'venue', 'event', 'portfolio_property']),
  primaryIntent: z.enum(['', 'inquiry', 'tour', 'visit', 'private_appointment', 'apply', 'register_interest', 'waitlist', 'pricing_availability_request', 'brochure_request', 'broker_registration', 'sales_inquiry', 'commercial_leasing_inquiry', 'rfp', 'professional_referral', 'directions', 'external_booking']),
  country: short, timezone: short.refine(v => { if (!v) return true; try { new Intl.DateTimeFormat('en', { timeZone: v }); return true } catch { return false } }, 'Choose a valid IANA timezone, such as America/Los_Angeles.'),
  canonicalName: short, aliases: text, ownershipEntity: short, managementCompany: short, market: short, submarket: short,
  products: z.array(z.enum(Object.keys(SETUP_PRODUCTS) as [keyof typeof SETUP_PRODUCTS, ...(keyof typeof SETUP_PRODUCTS)[]])).max(7).refine(v => new Set(v).size === v.length, 'Choose each product once.'),
  setupOwner: short, launchTarget: date, successMetric: short, successTarget: short,
  publicContact: z.object({ name: short, phone: short, email, confirmed: z.boolean() }).strict().refine(v => !v.confirmed || (!!v.phone && !!v.email), 'Provide public phone and email before confirming their use.'),
  tourUrl: reference, applicationUrl: reference, officeHours: text,
  brandMode: z.enum(['', 'existing', 'new', 'later']), brandVoice: text, audience: text,
  legalEntity: short, jurisdiction: short, reviewer: short,
  sources: z.array(sourcePlanSchema).max(20).refine(v => new Set(v.map(x => x.id)).size === v.length, 'Source identities must be unique.'),
}).strict()
export type SetupIntake = z.infer<typeof intakeSchema>
export type SourcePlan = z.infer<typeof sourcePlanSchema>

export function emptyIntake(): SetupIntake {
  return { version: 1, subjectKind: '', scope: '', sector: '', transaction: '', lifecycle: '', offeringKind: '', primaryIntent: '',
    country: '', timezone: '', canonicalName: '', aliases: '', ownershipEntity: '', managementCompany: '', market: '', submarket: '',
    products: [], setupOwner: '', launchTarget: '', successMetric: '', successTarget: '', publicContact: { name: '', phone: '', email: '', confirmed: false },
    tourUrl: '', applicationUrl: '', officeHours: '', brandMode: '', brandVoice: '', audience: '', legalEntity: '', jurisdiction: '', reviewer: '', sources: [] }
}
export function newSourcePlan(): SourcePlan {
  return { id: crypto.randomUUID(), kind: 'website', label: '', reference: '', provider: '', externalId: '', owner: '', observedAt: '', reviewAfter: '', visibility: 'internal', notes: '' }
}
export function readIntake(property: { settings?: unknown }): SetupIntake | null {
  const settings = property.settings && typeof property.settings === 'object' ? property.settings as Record<string, unknown> : {}
  const parsed = intakeSchema.safeParse(settings.onboarding)
  return parsed.success ? parsed.data : null
}
export function publicContactFromProperty(property: { settings?: unknown }) {
  const settings = property.settings && typeof property.settings === 'object' ? property.settings as Record<string, unknown> : {}
  const parsed = intakeSchema.shape.publicContact.safeParse(settings.publicContact)
  return parsed.success && parsed.data.confirmed ? parsed.data : null
}
export const setupDestination = (propertyId: string) => `/dashboard/community?propertyId=${encodeURIComponent(propertyId)}&section=checklist`

/** Seed optional intake from existing canonical values without changing the saved snapshot. */
export function intakeForEditing(profile: { intake?: SetupIntake; brandVoice: string; targetAudience: string }, property?: { address?: unknown; settings?: unknown }): SetupIntake {
  const address = property?.address && typeof property.address === 'object' ? property.address as Record<string, unknown> : {}
  const settings = property?.settings && typeof property.settings === 'object' ? property.settings as Record<string, unknown> : {}
  const existing = profile.intake ?? { ...emptyIntake(), country: typeof address.country === 'string' ? address.country : '', timezone: typeof settings.timezone === 'string' ? settings.timezone : '', publicContact: publicContactFromProperty(property || {}) ?? emptyIntake().publicContact }
  return { ...existing, brandVoice: profile.brandVoice, audience: profile.targetAudience }
}
