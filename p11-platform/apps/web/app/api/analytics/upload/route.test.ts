import {describe,it,expect} from 'vitest'
import {GET,POST} from './route'
describe('retired unrecorded CSV upload',()=>{it('requires the retained import workflow for both reads and writes',async()=>{expect((await GET()).status).toBe(410);expect((await POST()).status).toBe(410)})})
