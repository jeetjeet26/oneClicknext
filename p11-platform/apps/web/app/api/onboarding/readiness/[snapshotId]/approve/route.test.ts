import {it,expect} from 'vitest'
import {POST} from './route'
it('closes approval without a saved version and current source review',async()=>{const r=await POST();expect(r.status).toBe(410);expect(r.headers.get('Cache-Control')).toBe('private, no-store')})
