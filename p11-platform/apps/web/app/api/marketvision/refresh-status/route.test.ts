import {beforeEach,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({auth:vi.fn(),read:vi.fn()}))
vi.mock('@/utils/marketvision/decision-store',async original=>({...await original<typeof import('@/utils/marketvision/decision-store')>(),requireMarketOperator:m.auth}))
vi.mock('@/utils/marketvision/refresh-status',()=>({readRefreshStatus:m.read}))
import {GET} from './route'
import {MarketStoreError} from '@/utils/marketvision/decision-store'
const id='11111111-1111-1111-1111-111111111111',request=(query=`propertyId=${id}`)=>GET(new NextRequest(`http://localhost/?${query}`))
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue('actor');m.read.mockResolvedValue({propertyId:id,competitors:[],warnings:[]})})
it.each([401,403])('blocks unauthorized refresh reads (%s)',async status=>{m.auth.mockRejectedValue(new MarketStoreError('Unavailable',status));expect((await request()).status).toBe(status);expect(m.read).not.toHaveBeenCalled()})
it('returns refresh history only after rechecking current property access',async()=>{const response=await request();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(m.auth).toHaveBeenCalledTimes(2);expect(m.read).toHaveBeenCalledWith(id)})
it('discards a response when access changes during the read',async()=>{m.auth.mockResolvedValueOnce('actor').mockRejectedValueOnce(new MarketStoreError('Unavailable',403));expect((await request()).status).toBe(403)})
it.each(['propertyId=bad',`propertyId=${id}&propertyId=${id}`,`propertyId=${id}&all=true`])('rejects ambiguous profile scope %s',async query=>{expect((await request(query)).status).toBe(400);expect(m.read).not.toHaveBeenCalled()})
