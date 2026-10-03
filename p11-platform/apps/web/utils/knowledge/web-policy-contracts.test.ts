import {it,expect} from 'vitest'
import {webPolicyCommand,webPolicyQuery} from './web-policy-contracts'
const id='11111111-1111-1111-1111-111111111111',body={requestId:id,propertyId:id,operation:'save',expectedRevision:0,enabled:true,intervalHours:72,dailyLimit:1,confirmed:true,reason:'Review published-source scope'}
it('accepts local property identities and explicit complete policy',()=>{expect(webPolicyCommand.parse(body)).toEqual(body)})
it.each([{dailyLimit:0},{dailyLimit:6},{dailyLimit:1.5},{intervalHours:23},{intervalHours:169},{expectedRevision:-1},{confirmed:false},{enabled:'true'},{urls:['https://example.test']},{reason:' '}])('rejects an invalid or unreviewed policy %j',change=>{expect(webPolicyCommand.safeParse({...body,...change}).success).toBe(false)})
it('validates exact history recovery and fences',()=>{expect(webPolicyQuery.safeParse({propertyId:id,kind:'decision'}).success).toBe(false);expect(webPolicyQuery.safeParse({propertyId:id,kind:'policy',decisionId:id}).success).toBe(false);expect(webPolicyQuery.safeParse({propertyId:id,offset:1000,expectedHash:'a'.repeat(64)}).success).toBe(true)})
