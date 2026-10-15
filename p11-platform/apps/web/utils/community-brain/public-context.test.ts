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
