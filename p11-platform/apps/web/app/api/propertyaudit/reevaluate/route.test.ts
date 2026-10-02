import {it,expect} from 'vitest'
import {POST} from './route'
it('retires unrecorded re-evaluation in favor of exact-source review',async()=>{const r=await POST();expect(r.status).toBe(410);expect((await r.json()).error).toContain('saved evaluation')})
