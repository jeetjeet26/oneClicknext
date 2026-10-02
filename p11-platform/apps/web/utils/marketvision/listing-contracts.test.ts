import { describe, expect, it } from 'vitest'
import { isMarketListing, listingDecision } from './listing-contracts'
const id='11111111-1111-1111-1111-111111111111'
const input={requestId:id,propertyId:id,competitorId:id,expectedVersion:2,reason:'Reviewed source',action:'save',url:'https://www.apartments.com/community/abc/'}
describe('reviewed listing contract',()=>{
 it('accepts complete public listing links and non-RFC database identifiers',()=>{expect(listingDecision.parse(input)).toEqual(input)})
 it.each(['https://evil.com/apartments.com/path','https://apartments.com.evil.com/path','https://apartments.com@evil.com/path','https://user@apartments.com/path','http://127.0.0.1/path','javascript:alert(1)','https://apartments.com/','https://apartments.com:8080/path','https://apartments.com/path\\@evil.com','https://apartments.com/path with spaces'])('rejects unsafe or incomplete source %s',value=>{expect(isMarketListing(value)).toBe(false)})
 it('requires reviewed version and reason, and rejects implicit scraping',()=>{for(const change of [{expectedVersion:0},{reason:''},{scrape:true}])expect(listingDecision.safeParse({...input,...change}).success).toBe(false)})
 it('removal is bound to the saved version and cannot replace it with a URL',()=>{expect(listingDecision.safeParse({...input,action:'remove'}).success).toBe(false);const remove=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='url'));expect(listingDecision.safeParse({...remove,action:'remove'}).success).toBe(true)})
})
