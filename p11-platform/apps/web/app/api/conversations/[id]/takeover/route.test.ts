import {it,expect} from 'vitest'
import {POST,DELETE} from './route'
it.each([POST,DELETE])('retired unrecorded takeover controls direct callers to the saved inbox',async handler=>{const response=handler();expect(response.status).toBe(410);expect(response.headers.get('cache-control')).toContain('no-store')})
