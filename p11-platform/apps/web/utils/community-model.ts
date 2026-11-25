import { isForSaleResidentialType } from './property-types'

export const TRANSACTIONS = ['rental', 'for_sale', 'care_services', 'commercial_lease', 'informational', 'destination_booking'] as const
export type CommunityTransaction = typeof TRANSACTIONS[number]
export interface CommunityModel {
  transaction: CommunityTransaction
  propertyType: string | null
  source: 'onboarding' | 'vertical_profile' | 'legacy_property_type'
  priceBasis: 'sale_price_usd' | 'monthly_rent_usd' | 'service_quote' | 'booking_rate' | 'unconfirmed'
  offeringNoun: string
  conversion: string
  researchFields: string[]
  instructions: string
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
/** Physical form and transaction are independent: a detached home can be rented. Explicit onboarding wins. */
export function communityModel(property: { property_type?: unknown; propertyType?: unknown; settings?: unknown; operatingModel?: unknown; operating_model?: unknown }): CommunityModel {
  const intake = object(object(property.settings).onboarding)
  const explicit = intake.transaction
  const operating = property.operatingModel ?? property.operating_model
  const valid = (v: unknown): v is CommunityTransaction => typeof v === 'string' && TRANSACTIONS.includes(v as CommunityTransaction)
  const propertyType = typeof (property.property_type ?? property.propertyType) === 'string' ? String(property.property_type ?? property.propertyType) : null
  const transaction = valid(explicit) ? explicit : valid(operating) ? operating : isForSaleResidentialType(propertyType) ? 'for_sale' : 'rental'
  const source = valid(explicit) ? 'onboarding' : valid(operating) ? 'vertical_profile' : 'legacy_property_type'
  const common = ['plans', 'availability', 'specifications', 'amenities', 'location', 'offers', 'messaging', 'conversion_flow', 'reviews', 'public_ads']
  const configs = {
    for_sale: { priceBasis: 'sale_price_usd', offeringNoun: 'homes and plans', conversion: 'sales inquiry or private appointment', researchFields: [...common, 'homesites', 'asking_prices', 'base_prices', 'hoa_dues', 'solar_ownership', 'premiums', 'included_features', 'incentive_terms', 'delivery_dates'], instructions: 'This community sells homes. Keep plan base prices separate from homesite asking prices and closed-sale prices. Track HOA dues, solar cost/ownership, lot premiums, upgrades, incentives and delivery dates separately. Never write a sale price to monthly rent, interpret total planned homes as available inventory, or treat a mortgage calculator example as an offer. Use sales inquiries, available homes and appointments; do not introduce rental applications or lease terms.' },
    rental: { priceBasis: 'monthly_rent_usd', offeringNoun: 'rental plans and units', conversion: 'tour or rental application', researchFields: [...common, 'monthly_rent', 'lease_terms', 'fees', 'deposits', 'concessions', 'move_in_dates'], instructions: 'This community rents residences. Track monthly asking rent, lease duration, recurring fees, deposits, concessions and available dates separately. Effective rent requires an explicit concession and lease term. Never treat sale prices, deposits or nightly rates as monthly rent.' },
    commercial_lease: { priceBasis: 'unconfirmed', offeringNoun: 'commercial spaces', conversion: 'commercial leasing inquiry', researchFields: [...common, 'lease_rate_basis', 'usable_area', 'lease_structure', 'operating_expenses'], instructions: 'This community leases commercial space. Preserve the stated rate unit, period, lease structure and operating expenses. Do not compare annual rates per square foot with monthly residential rents.' },
    care_services: { priceBasis: 'service_quote', offeringNoun: 'care residences and services', conversion: 'visit or care inquiry', researchFields: [...common, 'care_levels', 'service_inclusions', 'pricing_basis', 'assessment_requirements'], instructions: 'This community provides care services. Separate housing costs from care and service costs. Preserve assessment requirements and care level. Do not invent health outcomes, eligibility or a monthly residential rent from a bundled care quote.' },
    destination_booking: { priceBasis: 'booking_rate', offeringNoun: 'bookable stays', conversion: 'booking inquiry', researchFields: [...common, 'nightly_rates', 'dates', 'booking_fees'], instructions: 'This destination uses bookings. Preserve stay dates, nightly or total basis, fees and booking conditions. Do not use monthly rent or home sale comparisons.' },
    informational: { priceBasis: 'unconfirmed', offeringNoun: 'offerings', conversion: 'inquiry', researchFields: common, instructions: 'This subject is informational. Do not assume rental, sale or booking prices. Use only an explicitly established transaction and conversion goal.' },
  } as const
  return { transaction, propertyType, source, ...configs[transaction], researchFields: [...configs[transaction].researchFields] }
}
