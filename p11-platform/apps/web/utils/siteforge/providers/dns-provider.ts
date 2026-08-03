import { z } from 'zod'

export interface DnsProvider {
  upsertAddressRecord(input: {
    hostname: string
    address: string
  }): Promise<{ recordId: string }>
}

const cloudflareResponseSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ message: z.string().optional() })).default([]),
  result: z.unknown(),
})

export class CloudflareDnsProvider implements DnsProvider {
  constructor(
    private readonly zoneId: string,
    private readonly apiToken: string
  ) {}

  async upsertAddressRecord(input: {
    hostname: string
    address: string
  }): Promise<{ recordId: string }> {
    const hostname = z.string().trim().toLowerCase().min(3).parse(input.hostname)
    const address = z.ipv4().parse(input.address)
    const existing = await this.request(
      `/dns_records?type=A&name=${encodeURIComponent(hostname)}`,
      { method: 'GET' }
    )
    const records = z
      .array(z.object({ id: z.string() }))
      .parse(existing.result)
    const body = {
      type: 'A',
      name: hostname,
      content: address,
      ttl: 300,
      proxied: false,
    }
    const result = await this.request(
      records[0] ? `/dns_records/${records[0].id}` : '/dns_records',
      {
        method: records[0] ? 'PUT' : 'POST',
        body,
      }
    )
    const record = z.object({ id: z.string() }).parse(result.result)
    return { recordId: record.id }
  }

  private async request(
    endpoint: string,
    init: { method: 'GET' | 'POST' | 'PUT'; body?: unknown }
  ) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(
        this.zoneId
      )}${endpoint}`,
      {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(30_000),
      }
    )
    const payload = cloudflareResponseSchema.parse(await response.json())
    if (!response.ok || !payload.success) {
      throw new Error(
        `Cloudflare DNS update failed (${response.status}): ${
          payload.errors[0]?.message || 'unknown error'
        }`
      )
    }
    return payload
  }
}

export function getConfiguredDnsProvider(): DnsProvider | null {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN
  return zoneId && apiToken
    ? new CloudflareDnsProvider(zoneId, apiToken)
    : null
}
