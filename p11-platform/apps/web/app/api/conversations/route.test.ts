import {expect,it,vi}from 'vitest'
const storage=vi.fn();vi.mock('@/utils/supabase/admin',()=>({createServiceClient:storage}))
it('retired incomplete reader points to the paged inbox without accessing storage',async()=>{const{GET}=await import('./route');const r=await GET();expect(r.status).toBe(410);expect(await r.json()).toHaveProperty('error');expect(storage).not.toHaveBeenCalled()})
it('retired deletion retains original transcripts',async()=>{const{DELETE}=await import('./route');expect((await DELETE()).status).toBe(410);expect(storage).not.toHaveBeenCalled()})
