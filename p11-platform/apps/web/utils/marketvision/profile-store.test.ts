import {beforeEach,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({rpc:vi.fn(),brands:vi.fn()}))
vi.mock('./decision-store',async original=>({...await original<typeof import('./decision-store')>(),marketRpc:m.rpc}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:()=>({select:()=>({in:m.brands})})})}))
import {readCompetitorProfiles} from './profile-store'
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const property=id(1),competitor=id(2),actor=id(3)
const row={id:competitor,property_id:property,name:'Local competitor',is_active:true,version:1,units:[],amenities:[]}
beforeEach(()=>{
 vi.resetAllMocks();m.brands.mockResolvedValue({data:[{competitor_id:competitor,highlighted_amenities:['Pool'],positioning_statement:'Garden living'}],error:null})
 m.rpc.mockImplementation(async name=>name==='read_marketvision_competitors'?{state:'ready',competitors:[row]}:name==='read_marketvision_brand'?{state:'ready',items:[],nextCursor:null}:{state:'ready',propertyId:property,propertyName:'Your community',snapshotAt:'2026-10-15T12:00:00Z',windowStart:'2026-09-15T12:00:00Z',windowDays:30,competitors:[],units:[],history:[],captures:[],subjectUnits:[]})
})
it('merges the saved analysis without rewriting property amenities or source-review status',async()=>{
 const result=await readCompetitorProfiles(property,actor)
 expect(result.competitors[0]).toMatchObject({amenities:[],historicalBrand:{amenities:['Pool'],positioning:'Garden living'},reviewedBrand:null})
 expect(result.subject.name).toBe('Your community');expect(result.warnings).toEqual([])
 expect(m.brands).toHaveBeenCalledWith('competitor_id',[competitor])
})
it('never merges historical analysis for an unrelated competitor',async()=>{
 m.brands.mockResolvedValue({data:[{competitor_id:id(99),positioning_statement:'Other property secret'}],error:null})
 const result=await readCompetitorProfiles(property,actor);expect(result.competitors[0].historicalBrand).toBeNull();expect(JSON.stringify(result)).not.toContain('secret')
})
it('fails closed on mismatched property scope before loading research',async()=>{
 m.rpc.mockResolvedValueOnce({state:'ready',competitors:[{...row,property_id:id(99)}]})
 await expect(readCompetitorProfiles(property,actor)).rejects.toThrow('scope');expect(m.brands).not.toHaveBeenCalled()
})
it('keeps a recoverable warning rather than making missing analysis look like an empty profile',async()=>{
 m.brands.mockResolvedValue({data:null,error:{message:'Unavailable'}})
 const result=await readCompetitorProfiles(property,actor);expect(result.competitors).toHaveLength(1);expect(result.warnings).toContain('Historical analysis could not be loaded. Reload to try again.')
})
it('loads current reviews beyond the first page',async()=>{
 const original=m.rpc.getMockImplementation()!
 m.rpc.mockImplementation(async(name,args)=>name==='read_marketvision_brand'?args.p_cursor?{items:[{competitorId:competitor,review:{disposition:'published',sourceCurrent:true,claims:[]}}],nextCursor:null}:{items:[],nextCursor:id(44)}:original(name,args))
 const result=await readCompetitorProfiles(property,actor);expect(result.competitors[0].reviewedBrand?.disposition).toBe('published')
})
it('withholds comparison prices when integrity history is unavailable',async()=>{
 const original=m.rpc.getMockImplementation()!
 m.rpc.mockImplementation(async(name,args)=>name==='marketvision_brief_sources'?Promise.reject(Error('Unavailable')):name==='read_marketvision_competitors'?{competitors:[{...row,units:[{id:id(5),unit_type:'1BR',rent_min:2000,bedrooms:1}]}]}:original(name,args))
 const result=await readCompetitorProfiles(property,actor);expect(result.competitors[0].withheldUnitIds).toEqual([id(5)]);expect(result.warnings[0]).toContain('withheld')
})
