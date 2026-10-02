import {beforeEach,describe,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const {auth}=vi.hoisted(()=>({auth:vi.fn()}))
vi.mock('@/utils/marketvision/decision-store',async original=>({...await original<typeof import('@/utils/marketvision/decision-store')>(),requireMarketOperator:auth}))
import {GET,POST} from './route'
import {MarketStoreError} from '@/utils/marketvision/decision-store'
const id='11111111-1111-1111-1111-111111111111'
describe('retired unreviewed source routes',()=>{
 beforeEach(()=>{vi.clearAllMocks();auth.mockResolvedValue('actor')})
 it.each([401,403])('requires current property access %s',async status=>{auth.mockRejectedValue(new MarketStoreError('Unavailable',status));expect((await POST(new NextRequest('http://localhost/',{method:'POST',body:JSON.stringify({propertyId:id,action:'refresh'})}))).status).toBe(status)})
 it.each(['refresh','discover','find_listings','refresh_single','add_listing'])('does not launch legacy %s even if delivery is enabled',async action=>{const fetcher=vi.spyOn(global,'fetch');try{const r=await POST(new NextRequest('http://localhost/',{method:'POST',body:JSON.stringify({propertyId:id,action})}));expect(r.status).toBe(410);expect(fetcher).not.toHaveBeenCalled();expect(auth).toHaveBeenCalledWith(id)}finally{fetcher.mockRestore()}})
 it('does not probe the old data engine from status reads',async()=>{const fetcher=vi.spyOn(global,'fetch');try{expect((await GET(new NextRequest(`http://localhost/?propertyId=${id}`))).status).toBe(410);expect(fetcher).not.toHaveBeenCalled()}finally{fetcher.mockRestore()}})
})
