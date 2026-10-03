import {beforeEach,it,expect,vi} from 'vitest'
const d=vi.hoisted(()=>({actor:vi.fn(),download:vi.fn()}))
vi.mock('@/utils/knowledge/file-store',()=>({fileActor:d.actor,downloadOriginal:d.download,FileError:class extends Error{constructor(message:string,readonly status=503){super(message)}}}))
import {GET} from './route'
const id='11111111-1111-1111-1111-111111111111',url=`http://local?propertyId=${id}&fileId=${id}&decisionId=${id}`
beforeEach(()=>{vi.clearAllMocks();d.actor.mockResolvedValue('actor');d.download.mockResolvedValue({bytes:new Uint8Array([1,2,3]),fileName:'Private 🏡.pdf'})})
it('returns exact bytes only as a private attachment with no active content',async()=>{const r=await GET(new Request(url));expect(r.status).toBe(200);expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([1,2,3]));expect(r.headers.get('Content-Type')).toBe('application/octet-stream');expect(r.headers.get('Content-Disposition')).toContain('attachment;');expect(r.headers.get('Cache-Control')).toBe('private, no-store');expect(r.headers.get('Content-Security-Policy')).toContain('sandbox')})
it('requires prepared download identity and conceals private failure details',async()=>{expect((await GET(new Request('http://local'))).status).toBe(400);d.download.mockRejectedValue(new Error('database secret'));const r=await GET(new Request(url));expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'The private original is unavailable.'})})
