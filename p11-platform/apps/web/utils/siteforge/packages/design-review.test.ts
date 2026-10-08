import {beforeEach,it,expect,vi} from 'vitest'
import {strToU8} from 'fflate'
const mocks=vi.hoisted(()=>({create:vi.fn()}))
vi.mock('openai',()=>({default:class{responses={create:mocks.create}}}))
import {reviewWebsiteDesign} from './design-review'
const png=()=>{const b=new Uint8Array(1100);b.set([137,80,78,71,13,10,26,10]);return b}
const files=()=>({'DESIGN.md':strToU8('Intentional property design'),'review/desktop.png':png(),'review/mobile.png':png(),'design-review.json':strToU8(JSON.stringify({version:1,status:'reviewed',iterations:[{},{}],screenshots:[{viewport:'desktop',path:'review/desktop.png'},{viewport:'mobile',path:'review/mobile.png'}]}))})
beforeEach(()=>vi.clearAllMocks())
it('fails closed when the independent reviewer rejects the design',async()=>{mocks.create.mockResolvedValue({id:'review',output_text:JSON.stringify({passed:false,summary:'Empty layout',issues:['Add real property imagery']})});await expect(reviewWebsiteDesign(files(),'Property website')).rejects.toThrow('Design revision required');expect(mocks.create.mock.calls[0][0].input[1].content.filter((x:{type:string})=>x.type==='input_image')).toHaveLength(2)})
it('retains the independent verdict and its limited scope',async()=>{mocks.create.mockResolvedValue({id:'review',output_text:JSON.stringify({passed:true,summary:'Cohesive design',issues:[]})});expect(await reviewWebsiteDesign(files(),'Property website')).toMatchObject({passed:true,responseId:'review',scope:expect.stringContaining('staging runtime and human approval still required')})})
it('never sends missing or fabricated render evidence to the reviewer',async()=>{await expect(reviewWebsiteDesign({},'Property website')).rejects.toThrow('render evidence');expect(mocks.create).not.toHaveBeenCalled()})
