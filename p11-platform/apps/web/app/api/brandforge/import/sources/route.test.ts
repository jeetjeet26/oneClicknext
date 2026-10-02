import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const m = vi.hoisted(() => ({ getUser: vi.fn(), access: vi.fn(), rpc: vi.fn(), extract: vi.fn() }))
vi.mock('@/utils/supabase/server', () => ({ createClient: async () => ({auth:{getUser:m.getUser}}) }))
vi.mock('@/utils/services/auth-guard', () => ({validatePropertyAccess:m.access}))
vi.mock('@/utils/brandforge/operations', () => ({brandRpc:m.rpc,brandReply:(r:unknown)=>NextResponse.json(r)}))
vi.mock('unpdf', () => ({extractText:m.extract}))
function request(file:File) { const body=new FormData();body.set('propertyId','33333333-3333-3333-3333-333333333333');body.set('requestId','55555555-5555-4555-8555-555555555555');body.set('file',file);return new NextRequest('http://localhost/api/brandforge/import/sources',{method:'POST',body}) }
beforeEach(()=>{vi.clearAllMocks();m.getUser.mockResolvedValue({data:{user:{id:'user'}},error:null});m.access.mockResolvedValue({authorized:true});m.rpc.mockResolvedValue({state:'applied',sourceId:'saved'})})
describe('private brand review sources',()=>{
 it('saves extracted text through the private source command',async()=>{const {POST}=await import('./route');const r=await POST(request(new File(['Client brand #123456'],'brand.txt',{type:'text/plain'})));expect(r.status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('save_brand_import_source',expect.objectContaining({p_content:'Client brand #123456',p_name:'brand.txt',p_content_hash:expect.stringMatching(/^[a-f0-9]{64}$/)}));expect(m.extract).not.toHaveBeenCalled()})
 it('stops cross-property access before extraction',async()=>{m.access.mockResolvedValue({authorized:false});const {POST}=await import('./route');expect((await POST(request(new File(['%PDF-test'],'brand.pdf',{type:'application/pdf'})))).status).toBe(403);expect(m.extract).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled()})
 it('rejects fake PDFs before saving',async()=>{const {POST}=await import('./route');expect((await POST(request(new File(['wrong'],'brand.pdf',{type:'application/pdf'})))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled()})
 it('leaves an ambiguous save eligible for the same retry',async()=>{m.rpc.mockRejectedValue(new Error('lost reply'));const {POST}=await import('./route');const r=await POST(request(new File(['Client text'],'brand.txt',{type:'text/plain'})));expect(r.status).toBe(503);expect((await r.json()).error).toContain('Retry the same file')})
})
