import {beforeEach, expect, it, vi} from 'vitest'
import {BrainError, type GenerationContext} from '@/utils/community-brain/contracts'
const mocks=vi.hoisted(()=>({scope:vi.fn(),context:vi.fn()}))
vi.mock('@/utils/community-brain/server',()=>({resolveCommunityScope:mocks.scope,getCommunityContext:mocks.context}))
import {discoveryContext,loadDiscoveryContext} from './discovery-context'
const fixture=()=>({propertyId:'p',contextHash:'hash',canonical:{property:{property_type:'senior',amenities:['Pool']},facts:[{id:'living',key:'community_subtype',payload:{value:'active adult'}},{id:'known',key:'known_competitors',payload:{value:'Oak Village\nElm Court'}},{id:'avoid',key:'restricted_claims',payload:{value:'assisted living'}}],floorplans:[{bedrooms:1,rent_min:2000}],brand:null},evidence:[{evidenceId:'competitor',content:'Assisted living with nursing',allowedUses:['fact'],metadata:{describes:'competitor'}},{evidenceId:'unreviewed',content:'Memory care',allowedUses:['reference'],metadata:{}},{evidenceId:'community',content:'Community offers independent living',allowedUses:['fact'],metadata:{describes:'community'}}]} as unknown as GenerationContext)
beforeEach(()=>{vi.clearAllMocks();mocks.scope.mockResolvedValue({id:'scope'})})
it('uses reviewed community facts, inventory and evidence, separating known competitors',()=>{
 const result=discoveryContext(fixture())
 expect(result.known_competitors).toEqual(['Oak Village','Elm Court'])
 expect(result.avg_rent).toBe(2000)
 expect(result.bedrooms).toEqual([1])
 expect(result.signals.map(s=>s.text).join(' ')).toContain('community_subtype: active adult')
 expect(result.signals.map(s=>s.text).join(' ')).not.toMatch(/Memory care|Assisted living|assisted living|Oak Village/)
 expect(result.signals.map(s=>s.id)).toContain('evidence:community')
})
it('keeps permission errors fatal while availability failures use an explained fallback',async()=>{
 mocks.context.mockRejectedValue(new BrainError('No access',403))
 await expect(loadDiscoveryContext('actor','p')).rejects.toMatchObject({status:403})
 mocks.context.mockRejectedValue(new BrainError('Unavailable',503))
 expect(await loadDiscoveryContext('actor','p')).toMatchObject({context:null,warnings:[expect.stringContaining('temporarily unavailable')]})
 expect(mocks.scope).toHaveBeenCalledWith('actor','p','research')
})
it('uses saved onboarding transaction and editable profile hints without exporting private settings',()=>{
 const result=discoveryContext(fixture(),{special_features:['Independent living'],target_audience:'Active adult',settings:{onboarding:{transaction:'rental',setupOwner:'private person'}}})
 expect(result.signals).toContainEqual({id:'property:onboarding.transaction',text:'transaction_model: rental'})
 expect(JSON.stringify(result)).not.toContain('private person')
})
it('fingerprints the selected setup hints along with the reviewed knowledge',()=>{
 const first=discoveryContext(fixture(),{settings:{onboarding:{transaction:'rental'}}})
 const second=discoveryContext(fixture(),{settings:{onboarding:{transaction:'for_sale'}}})
 expect(first.context_hash).toMatch(/^[a-f0-9]{64}$/)
 expect(first.context_hash).not.toBe(second.context_hash)
})
