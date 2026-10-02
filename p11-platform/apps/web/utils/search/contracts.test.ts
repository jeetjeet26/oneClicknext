import {describe,expect,it}from 'vitest'
import {searchDecision,searchRead}from './contracts'
const id='11111111-1111-1111-1111-111111111111',base={id,propertyId:id,expectedActorId:id,operation:'search',query:'%_, (literal)',filter:'all'}
describe('recorded search contracts',()=>{
it('accepts literal punctuation and existing UUID identities',()=>expect(searchDecision.safeParse(base).success).toBe(true))
it.each([{query:'x'},{query:'x'.repeat(201)},{filter:'web'},{query:123},{id:'bad'},{extra:true},{expectedActorId:undefined}])('rejects invalid search %j',change=>expect(searchDecision.safeParse({...base,...change}).success).toBe(false))
it.each(['select','navigate'])('requires a saved scoped source for %s',operation=>{expect(searchDecision.safeParse({id,propertyId:id,expectedActorId:id,operation,searchId:id,key:'lead:'+id}).success).toBe(true);expect(searchDecision.safeParse({id,propertyId:id,expectedActorId:id,operation,searchId:id,key:'https://outside.invalid'}).success).toBe(false)})
it('allows recovery history but rejects old unscoped keyword reads',()=>{expect(searchRead.safeParse({propertyId:id,kind:'history'}).success).toBe(true);expect(searchRead.safeParse({q:'keyword'}).success).toBe(false)})
it('bounds result paging and unknown input',()=>{expect(searchRead.safeParse({propertyId:id,offset:'-1'}).success).toBe(false);expect(searchRead.safeParse({propertyId:id,kind:'source'}).success).toBe(false)})
})
