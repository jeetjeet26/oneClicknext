import {it,expect} from 'vitest'
import {competitorDecision,unitValues,configurationDecision,publicMarketUrl} from './decision-contracts'
const base={unit_type:'A1',bedrooms:1,bathrooms:null,sqft_min:null,sqft_max:null,rent_min:0,rent_max:null,deposit:null,available_count:null,move_in_specials:null}
it('retains zero and unknown values distinctly',()=>expect(unitValues.parse(base)).toEqual(base))
it.each([{rent_min:1200,rent_max:1000},{sqft_min:1000,sqft_max:800},{bedrooms:1.5},{available_count:-1},{rent_min:1.234},{bathrooms:1.23},{rent_min:Infinity},{rent_min:'123x'},{version:100}])('rejects invalid or forged unit values %o',value=>expect(unitValues.safeParse({...base,...value}).success).toBe(false))
it.each(['javascript:alert(1)','http://localhost','https://127.0.0.1','https://user:pass@example.com','https://example.com:1234','https://one.internal'])('rejects non-public links %s',value=>expect(publicMarketUrl(value)).toBe(false))
it('accepts public property website addresses',()=>expect(publicMarketUrl('https://www.example.com/community')).toBe(true))
it('rejects a fractional maximum competitor count',()=>expect(configurationDecision.safeParse({propertyId:'33333333-3333-3333-3333-333333333333',requestId:'55555555-5555-5555-5555-555555555555',reason:'Reviewed',expectedVersion:1,values:{is_enabled:true,scrape_frequency:'daily',radius_miles:3,max_competitors:1.5,auto_add:false}}).success).toBe(false))
it('does not accept unversioned archive commands',()=>expect(competitorDecision.safeParse({action:'archive',competitorId:'55555555-5555-5555-5555-555555555555'}).success).toBe(false))
