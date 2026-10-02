import {it,expect,vi} from 'vitest'
vi.mock('@/app/api/community/tasks/route',()=>({GET:vi.fn(async()=>Response.json({state:'ready',items:[],stats:{total:0}}))}))
import {GET,PATCH} from './route'
import {GET as nativeGet} from '@/app/api/community/tasks/route'
it('uses only the scoped checklist read, not integration credential rows',async()=>{expect(GET).toBe(nativeGet);expect(await(await GET(new Request('http://local'))).json()).toEqual({state:'ready',items:[],stats:{total:0}})})
it('closes the alternate unrecorded status mutation',async()=>expect((await PATCH()).status).toBe(410))
