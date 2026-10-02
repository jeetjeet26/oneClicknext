import {it,expect} from 'vitest'
import {POST} from './route'
it('retires the old unrecorded widget writer',async()=>{const r=await POST();expect(r.status).toBe(410);expect(r.headers.get('cache-control')).toBe('no-store')})
