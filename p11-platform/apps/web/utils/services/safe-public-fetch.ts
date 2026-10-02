/** Server-only public website transport. DNS is checked and pinned to the socket. */
import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { BlockList,isIP } from 'node:net'

const blocked = new BlockList()
for (const [ip, prefix] of [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8],
  ['169.254.0.0',16], ['172.16.0.0',12], ['192.0.0.0',24], ['192.0.2.0',24],
  ['192.168.0.0',16], ['198.18.0.0',15], ['198.51.100.0',24], ['203.0.113.0',24],
  ['224.0.0.0',4], ['240.0.0.0',4],
] as const) blocked.addSubnet(ip, prefix, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
for (const [ip, prefix] of [['2001::',23], ['2001:db8::',32], ['2002::',16], ['3fff::',20]] as const) {
  blocked.addSubnet(ip, prefix, 'ipv6')
}
export class UnsafePublicUrl extends Error {}
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}
let pendingDns = 0
async function boundedLookup(host:string) {
  if(pendingDns>=16) throw new Error('Website DNS capacity is busy')
  pendingDns++
  try {return await lookup(host,{all:true,verbatim:true})} finally {pendingDns--}
}
export async function resolvePublicTarget(input: string) {
  const url = new URL(input)
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) ||
      host === 'localhost' || host.endsWith('.localhost') || (!host.includes('.') && !isIP(host))) {
    throw new UnsafePublicUrl('Destination must be a public HTTP(S) website')
  }
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }]
    : await boundedLookup(host)
  if (!addresses.length || addresses.some(({address}) => !isPublicAddress(address))) {
    throw new UnsafePublicUrl('Destination resolves to a non-public address')
  }
  return { url, host, address: addresses[0] }
}

export type PublicFetchOptions = {
  timeoutMs?: number; maxBytes?: number; headers?: Record<string, string>; method?: 'GET' | 'HEAD'
}

export async function safePublicFetch(input: string, options: PublicFetchOptions = {}): Promise<Response> {
  return (await safePublicFetchWithMetadata(input, options)).response
}

export async function safePublicFetchWithMetadata(input: string, options: PublicFetchOptions = {}): Promise<{ response: Response; finalUrl: string }> {
  const deadline = Date.now() + Math.min(options.timeoutMs ?? 15000, 30000)
  const maxBytes = Math.min(options.maxBytes ?? 2_000_000, 5_000_000)
  let current = input
  for (let hop = 0; hop <= 5; hop++) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('Website request timed out')
    const target = await Promise.race([
      resolvePublicTarget(current),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS lookup timed out')), remaining) }),
    ]).finally(() => clearTimeout(timer))
    const response = await new Promise<Response>((resolve, reject) => {
      const { url, host, address } = target
      const request = (url.protocol === 'https:' ? https : http).request(url, {
        method: options.method ?? 'GET', agent: false, servername: isIP(host) ? undefined : host,
        // No second DNS lookup: the original hostname is retained for Host and TLS verification.
        lookup: (_name, opts, callback) => {
          if (opts.all) callback(null, [address])
          else callback(null, address.address, address.family)
        },
        headers: { 'user-agent': 'P11PublicWebsiteReader/1.0', ...options.headers,
          'accept-encoding': 'identity', host: url.host },
      }, res => {
        res.on('error', reject)
        const status = res.statusCode ?? 502
        const headers = new Headers()
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
        }
        if ([301,302,303,307,308].includes(status) || options.method === 'HEAD' || [204,304].includes(status)) {
          res.destroy(); resolve(new Response(null, { status, headers })); return
        }
        if (Number(headers.get('content-length')) > maxBytes ||
            !['', 'identity'].includes(headers.get('content-encoding') ?? '')) {
          res.destroy(new Error('Website response exceeds limits or uses unsupported compression')); return
        }
        const chunks: Buffer[] = []
        let bytes = 0
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > maxBytes) res.destroy(new Error('Website response exceeds byte limit'))
          else chunks.push(chunk)
        })
        res.on('error', reject)
        res.on('end', () => resolve(new Response(Buffer.concat(chunks), {status, headers})))
      })
      const timeout = setTimeout(() => request.destroy(new Error('Website request timed out')), Math.max(1, deadline - Date.now()))
      request.on('error', reject)
      request.on('close', () => clearTimeout(timeout))
      request.end()
    })
    if (![301,302,303,307,308].includes(response.status)) return { response, finalUrl: current }
    const location = response.headers.get('location')
    if (!location) return { response, finalUrl: current }
    current = new URL(location, target.url).toString()
  }
  throw new Error('Website exceeded redirect limit')
}
