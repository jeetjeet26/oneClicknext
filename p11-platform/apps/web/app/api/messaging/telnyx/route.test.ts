import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { POST } from './route'

const { rpc } = vi.hoisted(() => ({rpc: vi.fn()}))
vi.mock('@/utils/supabase/admin', () => ({createServiceClient: () => ({rpc})}))
const keys = generateKeyPairSync('ed25519')
const sender = '+12025550101'
const recipient = '+12025550102'
function event(text: string, auto?: string) {
  return JSON.stringify({data:{event_type:'message.received', payload:{
    from:{phone_number:recipient}, to:[{phone_number:sender}], text, autoresponse_type:auto,
  }}})
}
function request(body: string, signedBody = body, age = 0) {
  const time = String(Math.floor(Date.now()/1000) - age)
  const signature = sign(null, Buffer.from(time + '|' + signedBody), keys.privateKey)
  return new Request('https://example.invalid/api/messaging/telnyx',{method:'POST',body,
    headers:{'telnyx-timestamp':time,'telnyx-signature-ed25519':signature.toString('base64')}})
}
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({error:null})
  vi.stubEnv('TELNYX_PUBLIC_KEY', keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64'))
})
afterEach(() => vi.unstubAllEnvs())
it.each([[' STOP ',undefined],['STOP ALL',undefined],['custom localized keyword','STOP']])('records a signed opt-out for %s', async (text,auto) => {
  expect((await POST(request(event(text,auto)))).status).toBe(204)
  expect(rpc).toHaveBeenCalledWith('record_workflow_sms_optout',{p_sender:sender,p_recipient:recipient})
})
it('acknowledges ordinary replies without changing consent', async () => {
  expect((await POST(request(event('What time is the tour?')))).status).toBe(204)
  expect((await POST(request(event('START')))).status).toBe(204)
  expect(rpc).not.toHaveBeenCalled()
})
it('rejects an altered or stale event before reading the database', async () => {
  expect((await POST(request(event('STOP'),event('HELP')))).status).toBe(401)
  expect((await POST(request(event('STOP'),event('STOP'),3600))).status).toBe(401)
  expect(rpc).not.toHaveBeenCalled()
})
it('requests a provider retry when suppression could not be saved', async () => {
  rpc.mockResolvedValue({error:{code:'unavailable'}})
  expect((await POST(request(event('STOP')))).status).toBe(503)
})
