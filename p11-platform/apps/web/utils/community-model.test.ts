import { describe, expect, it } from 'vitest'
import { communityModel } from './community-model'
describe('community transaction', () => {
  it('uses onboarding instead of a physical-type assumption', () => {
    expect(communityModel({property_type:'single_family',settings:{onboarding:{transaction:'rental'}}}).priceBasis).toBe('monthly_rent_usd')
    expect(communityModel({property_type:'multifamily',settings:{onboarding:{transaction:'for_sale'}}}).priceBasis).toBe('sale_price_usd')
  })
  it('preserves care, commercial and booking models', () => {
    for (const transaction of ['care_services','commercial_lease','destination_booking'] as const) expect(communityModel({settings:{onboarding:{transaction}}}).transaction).toBe(transaction)
  })
  it('retains a disclosed legacy fallback and does not let retrieved text override setup', () => {
    expect(communityModel({property_type:'single_family'}).source).toBe('legacy_property_type')
    expect(communityModel({property_type:'single_family',settings:{onboarding:{transaction:'for_sale'}},operatingModel:'rental'}).transaction).toBe('for_sale')
  })
})
