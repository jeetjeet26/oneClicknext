import { expect, it } from 'vitest'
import { discoveryCandidates, discoveryResponse } from './discovery-contracts'
it('deduplicates nearby results and drops unsafe links before displaying or saving them', () => {
  const row = {name: 'Community', website_url: 'javascript:alert(1)', property_type: 'apartment', ils_listings: {google_places: 'https://maps.google.com/place'}}
  const result = discoveryCandidates(discoveryResponse.parse({success: true, data: {success: true, property_name: 'Subject', competitors: [row, row]}}))
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({sourceUrl: 'https://maps.google.com/place', values: {website_url: null, property_type: 'multifamily'}})
})
it('preserves broader matches and their evidence when saved', () => {
 const match={tier:'broader',score:1,distance_miles:2,subtype:null,confidence:'limited',reasons:['Nearby residential alternative.'],gaps:['Services need verification.'],source_ids:['fact:living'],context_hash:'hash'}
 const result=discoveryCandidates(discoveryResponse.parse({success:true,data:{success:true,property_name:'Subject',competitors:[{name:'Alternative',match}]}}))
 expect(result[0].match?.tier).toBe('broader')
 expect(result[0].values.notes).toContain('Broader alternatives')
 expect(result[0].values.notes).toContain('fact:living')
 expect(result[0].values.notes).toContain('hash')
})
