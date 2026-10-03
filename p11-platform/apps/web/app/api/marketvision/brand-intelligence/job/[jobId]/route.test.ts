import {it,expect,vi} from 'vitest'
import {GET} from './route'
it('retires legacy brand work without provider execution',async()=>{const fetch=vi.spyOn(globalThis,'fetch');try{for(const handler of [GET]){const response=await handler();expect(response.status).toBe(410);expect(await response.json()).toMatchObject({error:expect.stringContaining('retired')})}expect(fetch).not.toHaveBeenCalled()}finally{fetch.mockRestore()}})
