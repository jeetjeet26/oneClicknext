import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ embed: vi.fn(), kind: '', property: 'property' }))
vi.mock('openai', () => ({ default: class { embeddings = { create: mocks.embed } } }))
vi.mock('@/utils/brandforge/operations', async () => {
 const { z } = await import('zod');const { NextResponse } = await import('next/server')
 return { brandId: z.string(), runBrandCommand: async (_req: unknown,kind: string,_fields:unknown,execute:(context:unknown)=>Promise<unknown>) => { mocks.kind=kind;return NextResponse.json(await execute({body:{brandAssetId:'brand',propertyId:mocks.property},brand:{id:'brand',property_id:'property',revision:4,section_1_introduction:{content:'Reviewed brand'},approval_status:'approved'}})) } }
})
import { POST } from './route'
const request = () => new NextRequest('http://localhost/api/brandforge/embed-to-kb',{method:'POST'})
beforeEach(()=>{vi.clearAllMocks();mocks.property='property';mocks.embed.mockImplementation(async ({input}:{input:string[]})=>({data:input.map((_,index)=>({index,embedding:Array(1536).fill(0.01)}))}))})
it('prepares a complete replacement with the actual approved revision and no premature document writes',async()=>{const response=await POST(request());const result=await response.json();expect(mocks.kind).toBe('publish');expect(result.updates).toEqual({});expect(result.result).toMatchObject({embeddedChunks:2,totalChunks:2,publishedRevision:4,contextRefresh:'pending'});expect(result.result.knowledgeReceipt.documents).toHaveLength(2);expect(mocks.embed).toHaveBeenCalledOnce()})
it.each(['missing','short','nan'])('rejects %s vector results before supplying any replacement to the transaction',async failure=>{mocks.embed.mockResolvedValue({data:failure==='missing'?[]:[{index:0,embedding:Array(1536).fill(0.01)},{index:1,embedding:failure==='short'?[0.1]:Array(1536).fill(NaN)}]});await expect(POST(request())).rejects.toThrow(/embedding response/)})
it('binds the publication to the saved property',async()=>{mocks.property='different';await expect(POST(request())).rejects.toThrow('Property mismatch');expect(mocks.embed).not.toHaveBeenCalled()})
it('leaves publication to the transaction when the provider fails',async()=>{mocks.embed.mockRejectedValue(new Error('provider unavailable'));await expect(POST(request())).rejects.toThrow('provider unavailable')})
