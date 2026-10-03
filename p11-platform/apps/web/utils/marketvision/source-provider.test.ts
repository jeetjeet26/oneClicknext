import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
const read = vi.hoisted(() => vi.fn())
vi.mock('@/utils/services/safe-public-fetch', () => ({ safePublicFetchWithMetadata: read, UnsafePublicUrl: class UnsafePublicUrl extends Error {} }))
import { UnsafePublicUrl } from '@/utils/services/safe-public-fetch'
import { acquirePublicSource } from './source-provider'
const url = 'https://example.com/floorplans/'
function respond(body: string, type = 'text/html', status = 200) { read.mockResolvedValue({ response: new Response(body, { status, headers: { 'content-type': type } }), finalUrl: 'https://example.com/current/' }) }
beforeEach(() => vi.clearAllMocks())
describe('retained public page acquisition', () => {
 it('retains the exact page, final URL, hash and normalized static text without scripts', async () => {
  const body='<html><head><title>Current plans</title></head><body><script>Do not retain script instructions</script><div>A1 has 1 bedroom.</div><p>Starting at $1200 monthly rent in USD.</p><p>Contact the property to confirm availability.</p></body></html>'
  respond(body); const result=await acquirePublicSource(url)
  expect(result).toMatchObject({status:'received',requestedUrl:url,finalUrl:'https://example.com/current/',body,bodyHash:createHash('sha256').update(body).digest('hex'),parserVersion:'public-html-v1',textTruncated:false})
  expect(result.text).toContain('A1 has 1 bedroom.\n');expect(result.text).not.toContain('script instructions');expect(read).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledWith(url,expect.objectContaining({maxBytes:1000000,timeoutMs:25000}))
 })
 it('marks truncated extraction text while retaining the complete bounded response',async()=>{const body='Repeated floor plan source '.repeat(2500);respond(body,'text/plain');const r=await acquirePublicSource(url);expect(r.status).toBe('received');expect(r.textTruncated).toBe(true);expect(r.text!.length).toBeLessThanOrEqual(50000);expect(r.body).toBe(body)})
 it('an HTTP failure is not pricing evidence',async()=>{respond('Denied','text/html',403);expect(await acquirePublicSource(url)).toMatchObject({status:'failed',errorCode:'http_error',statusCode:403});expect(read).toHaveBeenCalledOnce()})
 it.each([['application/json','{}','unsupported_content'],['text/html; charset=windows-1252','legacy text','unsupported_encoding'],['text/html','<div>Loading…</div>','insufficient_text'],['text/plain','bad\0binary','unsupported_encoding']])('holds unsupported response %s',async(type,body,errorCode)=>{respond(body,type);expect(await acquirePublicSource(url)).toMatchObject({status:'failed',errorCode})})
 it('browser challenge pages cannot become captured pricing sources',async()=>{respond('<title>Just a moment...</title><body>Enable JavaScript and cookies to continue. Checking your browser before accessing the website.</body>');expect(await acquirePublicSource(url)).toMatchObject({status:'failed',errorCode:'challenge_page'})})
 it('retains uncertainty without repeating network requests',async()=>{read.mockRejectedValue(new Error('network interruption'));expect(await acquirePublicSource(url)).toMatchObject({status:'uncertain',errorCode:'fetch_unconfirmed'});expect(read).toHaveBeenCalledOnce()})
 it('unsafe public destinations are held before any usable capture',async()=>{read.mockRejectedValue(new UnsafePublicUrl('blocked'));expect(await acquirePublicSource(url)).toMatchObject({status:'failed',errorCode:'unsafe_source'})})
})
