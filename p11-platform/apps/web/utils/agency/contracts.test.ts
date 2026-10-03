import {expect,it} from 'vitest'
import {agencyCommand,agencyQuery,agencyProducts,productLinks} from './contracts'
import {pageObservation} from '@/utils/actions/catalog'
const id='11111111-1111-4111-8111-111111111111'
const command={propertyId:id,requestId:id,operation:'review',product:'siteforge',sourceHash:'a'.repeat(64),decision:'watch',reason:'Reviewed work'}
it('accepts exact scoped observation choices',()=>{expect(agencyCommand.parse(command)).toEqual(command);expect(agencyProducts.every(p=>productLinks[p].startsWith('/dashboard'))).toBe(true)})
it.each([{executeNow:true},{actorId:id},{budget:100},{trainingEligible:true},{sourceHash:'invalid'},{reason:' '},{decision:'approve'},{product:'unknown'}])('rejects unsupported authority and invalid inputs %j',extra=>{expect(agencyCommand.safeParse({...command,...extra}).success).toBe(false)})
it('validates stable history cursors and scoped receipt queries',()=>{expect(agencyQuery.safeParse({propertyId:id,kind:'history',before:'20'}).success).toBe(true);for(const extra of[{kind:'history',before:'NaN'},{kind:'history',before:'9223372036854775808'},{kind:'decision'},{kind:'board',before:'20'},{actorId:id}])expect(agencyQuery.safeParse({propertyId:id,...extra}).success).toBe(false)})
it('records only the agency page family',()=>{expect(pageObservation('/dashboard/agency')).toEqual({product:'agency',path:'/dashboard/agency'})})
