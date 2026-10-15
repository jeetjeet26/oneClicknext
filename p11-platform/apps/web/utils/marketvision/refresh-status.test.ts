import {it,expect,vi} from 'vitest'
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:vi.fn()}))
import {propertyRefreshOutcome} from './refresh-status'
it('returns only the selected property outcome from a shared run',()=>{
 expect(propertyRefreshOutcome({outcomes:[{propertyId:'other',success:true,updated:99,private:'excluded'},{propertyId:'mine',success:false,updated:2,receipt:'partial',private:'excluded'}]},'mine')).toEqual({result:'partial',updated:2})
 expect(propertyRefreshOutcome({outcomes:[{propertyId:'other',success:true,updated:99}]},'mine')).toBeNull()
})
it('keeps timeout outcomes uncertain instead of claiming that no data was saved',()=>{
 expect(propertyRefreshOutcome({outcomes:[{propertyId:'mine',success:false,updated:0}]},'mine')).toEqual({result:'unconfirmed',updated:0})
 expect(propertyRefreshOutcome({outcomes:[{propertyId:'mine',success:false,updated:0,receipt:'failed'}]},'mine')?.result).toBe('failed')
})
