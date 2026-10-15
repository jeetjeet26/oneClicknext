import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const mocks=vi.hoisted(()=>({portfolio:vi.fn(),question:vi.fn()}))
vi.mock('@/utils/intelligence/portfolio',()=>({readPortfolio:mocks.portfolio}))
vi.mock('@/utils/intelligence/questions',()=>({answerPortfolioQuestion:mocks.question}))
vi.mock('@/utils/team/http',()=>({requireTeamOrigin:vi.fn(),teamBody:(r:Request)=>r.json()}))
import {GET,POST} from './route'
const propertyId='11111111-1111-4111-8111-111111111111'
const dates={start:'2026-10-01',end:'2026-10-10'}
describe('property intelligence scope',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.portfolio.mockResolvedValue({properties:[]});mocks.question.mockReturnValue({answer:[]})})
  it('rejects an unscoped internal report instead of loading the portfolio',async()=>{
    const response=await GET(new NextRequest('http://localhost/api/intelligence?'+new URLSearchParams({kind:'portfolio',...dates})))
    expect(response.status).toBe(400)
    expect(mocks.portfolio).not.toHaveBeenCalled()
  })
  it('passes the selected property to the authorized report reader',async()=>{
    const response=await GET(new NextRequest('http://localhost/api/intelligence?'+new URLSearchParams({kind:'portfolio',propertyId,...dates})))
    expect(response.status).toBe(200)
    expect(mocks.portfolio).toHaveBeenCalledWith(dates.start,dates.end,false,propertyId)
  })
  it('requires the same scope for questions',async()=>{
    const body={action:'question',question:'What changed?',...dates}
    const request=(data:unknown)=>new NextRequest('http://localhost/api/intelligence',{method:'POST',body:JSON.stringify(data)})
    expect((await POST(request(body))).status).toBe(400)
    expect(mocks.portfolio).not.toHaveBeenCalled()
    expect((await POST(request({...body,propertyId}))).status).toBe(200)
    expect(mocks.portfolio).toHaveBeenCalledWith(dates.start,dates.end,false,propertyId)
  })
})
