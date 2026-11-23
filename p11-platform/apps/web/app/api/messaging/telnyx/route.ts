import { createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'

export const runtime = 'nodejs'
const phone = z.object({ phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/) })
const incoming = z.object({
  from: phone,
  to: z.array(phone).min(1).max(20),
  text: z.string().nullish(),
  autoresponse_type: z.string().nullish(),
})
const stopWords = new Set(['STOP','STOPALL','STOP ALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPT OUT'])

export async function POST(request: Request) {
  const key = process.env.TELNYX_PUBLIC_KEY
  if (!key) return new Response(null, {status: 503})
  const timestamp = request.headers.get('telnyx-timestamp') ?? ''
  const signature = request.headers.get('telnyx-signature-ed25519')
  if (!signature || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now()/1000 - Number(timestamp)) > 300)
    return new Response(null, {status: 401})

  const reader = request.body?.getReader()
  if (!reader) return new Response(null, {status: 400})
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const {value, done} = await reader.read()
      if (done) break
      total += value.length
      if (total > 65536) {
        await reader.cancel()
        return new Response(null, {status: 413})
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const raw = Buffer.concat(chunks)
  let publicKey
  try {
    publicKey = createPublicKey({format: 'der', type: 'spki', key: Buffer.concat([
      Buffer.from('302a300506032b6570032100','hex'), Buffer.from(key,'base64'),
    ])})
  } catch { return new Response(null, {status: 503}) }
  if (!verify(null, Buffer.concat([Buffer.from(timestamp + '|'), raw]), publicKey, Buffer.from(signature,'base64')))
    return new Response(null, {status: 401})

  let event
  try { event = JSON.parse(raw.toString('utf8'))?.data } catch { return new Response(null, {status: 400}) }
  if (typeof event?.event_type !== 'string') return new Response(null, {status: 400})
  if (event.event_type !== 'message.received') return new Response(null, {status: 204})
  const parsed = incoming.safeParse(event.payload)
  if (!parsed.success) return new Response(null, {status: 400})
  const {from, to, text, autoresponse_type} = parsed.data
  if (autoresponse_type?.toUpperCase() === 'STOP' || stopWords.has(text?.trim().toUpperCase() ?? '')) {
    const db = createServiceClient()
    for (const sender of to) {
      const result = await db.rpc('record_workflow_sms_optout', {p_sender:sender.phone_number, p_recipient:from.phone_number})
      if (result.error) return new Response(null, {status: 503})
    }
  }
  return new Response(null, {status: 204})
}
