import { expect, it } from 'vitest'
import { discoveryCandidates, discoveryResponse } from './discovery-contracts'
it('deduplicates nearby results and drops unsafe links before displaying or saving them', () => {
  const row = {name: 'Community', website_url: 'javascript:alert(1)', property_type: 'apartment', ils_listings: {google_places: 'https://maps.google.com/place'}}
  const result = discoveryCandidates(discoveryResponse.parse({success: true, data: {success: true, property_name: 'Subject', competitors: [row, row]}}))
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({sourceUrl: 'https://maps.google.com/place', values: {website_url: null, property_type: 'multifamily'}})
})
