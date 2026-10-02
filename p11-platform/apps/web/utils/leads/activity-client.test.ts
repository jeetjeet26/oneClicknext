import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { saveNoteDecision } from './activity-client'
const values=new Map<string,string>(), send=vi.fn()
beforeEach(()=>{values.clear();send.mockReset();vi.stubGlobal('sessionStorage',{getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});vi.stubGlobal('fetch',send)})
afterEach(()=>vi.unstubAllGlobals())
const input={propertyId:'property',action:'add',content:'Private internal note',reason:'Record inquiry'}
const saved=()=>new Response(JSON.stringify({result:{state:'saved',version:1}}),{status:200})
it('keeps only a hashed identity and reuses it after a lost reply; confirmed new intent receives a new identity',async()=>{
 send.mockRejectedValueOnce(new Error('Lost reply')).mockResolvedValueOnce(saved()).mockResolvedValueOnce(saved())
 await expect(saveNoteDecision('lead',input)).rejects.toThrow('Lost reply')
 expect([...values.keys()]).toEqual([expect.stringMatching(/^p11\.lead-note\.[a-f0-9]{64}$/)]);expect([...values.entries()].flat().join('')).not.toContain(input.content)
 await saveNoteDecision('lead',input);expect(values.size).toBe(0);await saveNoteDecision('lead',input)
 const bodies=send.mock.calls.map(c=>JSON.parse(c[1].body));expect(bodies[0].requestId).toBe(bodies[1].requestId);expect(bodies[2].requestId).not.toBe(bodies[0].requestId)
})
it('separates lead, property and exact correction identities and retains unsuccessful requests',async()=>{
 send.mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({error:'Stale note'}),{status:409})))
 for(const [lead,body]of [['one',input],['two',input],['one',{...input,propertyId:'other'}],['one',{...input,content:'Correction'}]]as const)await expect(saveNoteDecision(lead,body)).rejects.toThrow('Stale note')
 expect(new Set(send.mock.calls.map(c=>JSON.parse(c[1].body).requestId)).size).toBe(4);expect(values.size).toBe(4)
})
it('does not send without recovery storage or accept a 200 response lacking a confirmed decision',async()=>{
 vi.stubGlobal('sessionStorage',{getItem:()=>{throw new Error('Unavailable')}});await expect(saveNoteDecision('lead',input)).rejects.toThrow('recovery storage');expect(send).not.toHaveBeenCalled()
 vi.stubGlobal('sessionStorage',{getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()});send.mockResolvedValue(new Response('{}'));await expect(saveNoteDecision('lead',input)).rejects.toThrow('could not be confirmed')
})
