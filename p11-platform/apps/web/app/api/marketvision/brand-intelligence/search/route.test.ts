import {it,expect,vi} from 'vitest'
import {POST} from './route'
it('retires legacy brand work without provider execution',async()=>{const fetch=vi.spyOn(globalThis,'fetch');try{for(const handler of [POST]){const response=await handler();expect(response.status).toBe(410);expect(await response.json()).toMatchObject({error:expect.stringContaining('retired')})}expect(fetch).not.toHaveBeenCalled()}finally{fetch.mockRestore()}})
