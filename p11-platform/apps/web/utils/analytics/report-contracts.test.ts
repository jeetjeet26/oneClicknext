import{describe,it,expect}from'vitest'
import{biCommand,biFilters,biRead}from'./report-contracts'
import{biPendingKey,parseBiPending}from'./report-client'
const id='33333333-3333-3333-3333-333333333333'
const filters={startDate:'2026-08-01',endDate:'2026-08-31',compare:true,channel:null,account:null}
describe('report request contracts',()=>{
 it('permits the existing property UUID shape',()=>expect(biCommand.safeParse({operation:'cancel',propertyId:id,id,expectedActorId:id}).success).toBe(true))
 it.each(['2026-02-30','2026-9-1','oops'])('rejects invalid date %s',startDate=>expect(biFilters.safeParse({...filters,startDate}).success).toBe(false))
 it('bounds complete native snapshots to 366 inclusive dates',()=>{expect(biFilters.safeParse({...filters,startDate:'2026-01-01',endDate:'2027-01-01'}).success).toBe(true);expect(biFilters.safeParse({...filters,startDate:'2026-01-01',endDate:'2027-01-02'}).success).toBe(false)})
 it('preserves unknown source filter separately from all accounts',()=>expect(biFilters.parse({...filters,account:''}).account).toBe(''))
 it('rejects raw source or arbitrary metrics in commands',()=>expect(biCommand.safeParse({operation:'save',propertyId:id,id,expectedActorId:id,label:'Report',sourceHash:'a'.repeat(64),filters,source:{}}).success).toBe(false))
 it('does not allow a browser delivery claim',()=>expect(biCommand.safeParse({operation:'observe',propertyId:id,id,expectedActorId:id,outcome:'delivered'}).success).toBe(false))
 it('rejects negative or fractional history pages',()=>{expect(biRead.safeParse({propertyId:id,kind:'history',offset:'-1'}).success).toBe(false);expect(biRead.safeParse({propertyId:id,kind:'history',offset:'1.5'}).success).toBe(false)})
 it('namespaces pending requests by actor and property without storing report contents',()=>{expect(biPendingKey(id,id)).not.toBe(biPendingKey('other',id));expect(parseBiPending(JSON.stringify({id,kind:'save'}))).toEqual({id,kind:'save'});expect(()=>parseBiPending(JSON.stringify({id,kind:'save',source:{spend:12}}))).toThrow()})
 it('retains an observed outcome until confirmed instead of downloading again',()=>expect(parseBiPending(JSON.stringify({id,reportId:id,kind:'export',format:'pdf',outcome:'download_failed'}))?.kind).toBe('export'))
})
