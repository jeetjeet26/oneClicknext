import {beforeEach,expect,it,vi} from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('./server',()=>({brainRpc:rpc}))
import {currentPublicCommunityContext} from './public-context'
const request={configId:'config',sessionId:'session',query:'What homes are available?'}
beforeEach(()=>vi.resetAllMocks())
it('keeps current commercial limitations intact and includes only complete evidence items',async()=>{
 const canonical={facts:[{availability:'unconfirmed; contact sales'}],asOf:'2026-10-15T20:00:00Z'}
 const evidence=[{content:'A'.repeat(14000)},{content:'B'.repeat(4000)}]
 rpc.mockResolvedValue({propertyId:'a',canonical,evidence,asOf:'2026-10-15T20:00:00Z'})
 const result=await currentPublicCommunityContext('a',request)
 const rendered=JSON.parse(result.contextMarkdown.split('\n').slice(1).join('\n'))
 expect(rendered.canonical.facts).toEqual(canonical.facts)
 expect(rendered.evidence).toEqual([evidence[0]])
 expect(result.contextJson).toMatchObject({evidence}) // freshness checks retain the full read
})
it('withholds oversized canonical facts instead of cutting off qualifications',async()=>{
 rpc.mockResolvedValue({propertyId:'a',canonical:{facts:'A'.repeat(16001)},evidence:[],asOf:'2026-10-15T20:00:00Z'})
 await expect(currentPublicCommunityContext('a',request)).rejects.toThrow('context limit')
})
it('rejects another community before rendering its facts',async()=>{
 rpc.mockResolvedValue({propertyId:'b',canonical:{facts:[]},evidence:[],asOf:'2026-10-15T20:00:00Z'})
 await expect(currentPublicCommunityContext('a',request)).rejects.toThrow('another community')
})
it('makes room for approved detail without dropping claims, source references or the full audit read',async()=>{
 const facts=Array.from({length:40},(_,i)=>({id:`fact-${i}`,key:`reviewed-section-${i}`,revision:8,updated_at:'2026-10-16T20:50:00.000000Z',payload:{value:'Verified plan detail. Availability and pricing are unconfirmed; contact sales. Exact mirrored drawing is not verified.',sourceHash:'a'.repeat(64),sourceEvidenceId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',sourceUrl:'https://example.invalid/community/source',reviewAfter:'2026-11-14',visibility:'public'}}))
 const floorplan={id:'unit-a',property_id:'a',canonical_key:'unit-a-source-key',created_at:'2026-01-01T00:00:00Z',source_updated_at:'2026-10-16T20:50:00Z',unit_type:'Reverse plan',bedrooms:3,bathrooms:null,available_count:0,rent_min:null,move_in_specials:'Two full bathrooms plus two powder rooms; exact drawing unconfirmed.',expires_at:'2026-11-14T23:59:59Z',pricingExpired:false}
 const canonical={facts,floorplans:[floorplan],asOf:'2026-10-16T20:50:00Z'}
 expect(JSON.stringify(canonical).length).toBeGreaterThan(16000)
 rpc.mockResolvedValue({propertyId:'a',canonical,evidence:[],asOf:'2026-10-16T20:50:00Z'})
 const result=await currentPublicCommunityContext('a',request)
 const rendered=JSON.parse(result.contextMarkdown.split('\n').slice(1).join('\n'))
 expect(JSON.stringify(rendered).length).toBeLessThanOrEqual(16000)
 expect(rendered.canonical.facts).toHaveLength(facts.length)
 for(const [i,fact]of facts.entries()){
  const {sourceHash:_,...payload}=fact.payload
  expect(rendered.canonical.facts[i]).toEqual({id:fact.id,key:fact.key,payload})
 }
 expect(rendered.canonical.floorplans[0]).toMatchObject({id:floorplan.id,unit_type:floorplan.unit_type,bedrooms:3,bathrooms:null,available_count:0,rent_min:null,move_in_specials:floorplan.move_in_specials,source_updated_at:floorplan.source_updated_at,expires_at:floorplan.expires_at,pricingExpired:false})
 expect(result.contextJson).toMatchObject({canonical:{facts,floorplans:[floorplan]}})
 expect(canonical.facts[0].payload.sourceHash).toBe('a'.repeat(64))
})
