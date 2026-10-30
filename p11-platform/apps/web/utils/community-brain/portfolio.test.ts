import {describe,it,expect,vi} from 'vitest'
vi.mock('./server',()=>({brainRpc:vi.fn(),getCommunityContext:vi.fn(),requireCurrentScope:vi.fn(),resolvePortfolioScope:vi.fn()}))
import {validatePortfolioAnswer,type PortfolioGroup} from './portfolio'
const id='11111111-1111-4111-8111-111111111111'
const groups:PortfolioGroup[]=[{propertyId:id,name:'Test',state:'ready',evidenceKey:`community:${id}`,data:{sources:[{id:'source-a',propertyId:id,content:{rent:2000}},{id:'source-b',propertyId:id,content:{rent:3000}}]}}]
const answer=()=>({summary:'Available evidence is limited.',insights:[{observation:'Recorded rent is 2000.',communityIds:[id],evidenceKeys:[`community:${id}`],sourceIds:['source-a']}],missingData:['Observation date is unknown. Current pricing cannot be confirmed.'],recommendations:['Verify current pricing before comparison.']})
describe('portfolio source attribution',()=>{
 it('accepts a sourced observation with explicit missing data',()=>expect(validatePortfolioAnswer(answer(),groups).missingData).toHaveLength(1))
 it('rejects fabricated source references',()=>{const a=answer();a.insights[0].sourceIds=['invented'];expect(()=>validatePortfolioAnswer(a,groups)).toThrow('unavailable source')})
 it('rejects numbers supported only by an uncited source',()=>{const a=answer();a.insights[0].observation='Recorded rent is 3000.';expect(()=>validatePortfolioAnswer(a,groups)).toThrow('number outside')})
 it('requires a source for every finding',()=>{const a=answer();a.insights[0].sourceIds=[];expect(()=>validatePortfolioAnswer(a,groups)).toThrow()})
})
