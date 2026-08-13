import { z } from 'zod'

const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/)

export type DnsRecordIdentity = {
  provider: 'cloudflare'
  zoneId: string
  recordId: string
  type: 'A' | 'AAAA' | 'CNAME'
  hostname: string
  content: string
  ttl: number
  proxied: boolean
}

export type DnsZoneIdentity = {
  provider: 'cloudflare'
  zoneId: string
  zoneName: string
  accountId: string
  status: string
}

export type DnsInventory = {
  provider: 'cloudflare'
  zone: DnsZoneIdentity
  hostnames: string[]
  records: DnsRecordIdentity[]
  capturedAt: string
}

export type DnsPropagationReport = {
  checkedAt: string
  expectedAddress: string
  observations: Array<{
    hostname: string
    addresses: string[]
    propagated: boolean
  }>
  propagated: boolean
}

export interface DnsProvider {
  upsertAddressRecord(input: {
    hostname: string
    address: string
    recordId?: string
    ttl?: number
  }): Promise<DnsRecordIdentity>
  readInventory(hostnames: string[]): Promise<DnsInventory>
  probePropagation(input: {
    hostnames: string[]
    expectedAddress: string
  }): Promise<DnsPropagationReport>
}

const cloudflareResponseSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ message: z.string().optional() })).default([]),
  result: z.unknown(),
})

const cloudflareZoneSchema = z.object({
  id: z.string(),
  name: hostnameSchema,
  status: z.string(),
  account: z.object({ id: z.string() }),
})

const cloudflareRecordSchema = z.object({
  id: z.string(),
  zone_id: z.string(),
  type: z.enum(['A', 'AAAA', 'CNAME']),
  name: hostnameSchema,
  content: z.string().min(1),
  ttl: z.number().int().positive(),
  proxied: z.boolean().nullable().optional(),
})

export class CloudflareDnsProvider implements DnsProvider {
  constructor(
    private readonly zoneId: string,
    private readonly apiToken: string
  ) {}

  async upsertAddressRecord(input: {
    hostname: string
    address: string
    recordId?: string
    ttl?: number
  }): Promise<DnsRecordIdentity> {
    const hostname = hostnameSchema.parse(input.hostname)
    const address = z.ipv4().parse(input.address)
    const ttl = z
      .number()
      .int()
      .refine(value => value === 1 || (value >= 60 && value <= 86_400))
      .parse(input.ttl ?? 300)
    const zone = await this.readZoneIdentity(hostname)
    const existing = await this.request(
      `/dns_records?type=A&name=${encodeURIComponent(hostname)}&per_page=5000`,
      { method: 'GET' }
    )
    const records = z
      .array(cloudflareRecordSchema)
      .parse(existing.result)
    const exactRecord = input.recordId
      ? records.find(record => record.id === input.recordId)
      : records[0]
    if (input.recordId && !exactRecord) {
      throw new Error(
        `Cloudflare DNS record ${input.recordId} does not own ${hostname}`
      )
    }
    if (!input.recordId && records.length > 1) {
      throw new Error(
        `Cloudflare returned multiple A records for ${hostname}; exact record identity is required`
      )
    }
    if (
      exactRecord &&
      exactRecord.content === address &&
      exactRecord.ttl === ttl &&
      exactRecord.proxied === false
    ) {
      return this.toRecordIdentity(exactRecord)
    }
    const body = {
      type: 'A',
      name: hostname,
      content: address,
      ttl,
      proxied: false,
    }
    const result = await this.request(
      exactRecord ? `/dns_records/${exactRecord.id}` : '/dns_records',
      {
        method: exactRecord ? 'PUT' : 'POST',
        body,
      }
    )
    const record = cloudflareRecordSchema.parse(result.result)
    if (
      record.zone_id !== zone.zoneId ||
      record.name !== hostname ||
      record.content !== address
    ) {
      throw new Error(
        'Cloudflare returned a DNS record outside the exact requested identity'
      )
    }
    return this.toRecordIdentity(record)
  }

  async readInventory(hostnames: string[]): Promise<DnsInventory> {
    const normalizedHostnames = [
      ...new Set(hostnames.map(hostname => hostnameSchema.parse(hostname))),
    ].sort()
    if (!normalizedHostnames.length) {
      throw new Error('At least one DNS hostname is required')
    }
    const zone = await this.readZoneIdentity(normalizedHostnames[0])
    for (const hostname of normalizedHostnames) {
      this.assertZoneOwnsHostname(zone, hostname)
    }
    const records = (
      await Promise.all(
        normalizedHostnames.map(async hostname => {
          const response = await this.request(
            `/dns_records?name=${encodeURIComponent(hostname)}&per_page=5000`,
            { method: 'GET' }
          )
          return z.array(cloudflareRecordSchema).parse(response.result)
        })
      )
    )
      .flat()
      .map(record => {
        if (record.zone_id !== zone.zoneId) {
          throw new Error(
            'Cloudflare inventory returned a record from a different zone'
          )
        }
        return this.toRecordIdentity(record)
      })
      .sort((left, right) =>
        `${left.hostname}:${left.type}:${left.recordId}`.localeCompare(
          `${right.hostname}:${right.type}:${right.recordId}`
        )
      )
    return {
      provider: 'cloudflare',
      zone,
      hostnames: normalizedHostnames,
      records,
      capturedAt: new Date().toISOString(),
    }
  }

  async probePropagation(input: {
    hostnames: string[]
    expectedAddress: string
  }): Promise<DnsPropagationReport> {
    const expectedAddress = z.ipv4().parse(input.expectedAddress)
    const hostnames = [
      ...new Set(input.hostnames.map(hostname => hostnameSchema.parse(hostname))),
    ].sort()
    const observations = await Promise.all(
      hostnames.map(async hostname => {
        const response = await fetch(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(
            hostname
          )}&type=A`,
          {
            headers: { Accept: 'application/dns-json' },
            signal: AbortSignal.timeout(15_000),
          }
        )
        if (!response.ok) {
          throw new Error(
            `Public DNS propagation query failed for ${hostname} (${response.status})`
          )
        }
        const payload = z
          .object({
            Status: z.number().int(),
            Answer: z
              .array(z.object({ type: z.number().int(), data: z.string() }))
              .optional(),
          })
          .parse(await response.json())
        const addresses = [
          ...new Set(
            (payload.Answer || [])
              .filter(answer => answer.type === 1)
              .map(answer => answer.data)
          ),
        ].sort()
        return {
          hostname,
          addresses,
          propagated: payload.Status === 0 && addresses.includes(expectedAddress),
        }
      })
    )
    return {
      checkedAt: new Date().toISOString(),
      expectedAddress,
      observations,
      propagated:
        observations.length > 0 &&
        observations.every(observation => observation.propagated),
    }
  }

  private async readZoneIdentity(hostname: string): Promise<DnsZoneIdentity> {
    const response = await this.request('', { method: 'GET' })
    const zone = cloudflareZoneSchema.parse(response.result)
    if (zone.id !== this.zoneId) {
      throw new Error('Cloudflare zone identity does not match configuration')
    }
    const identity: DnsZoneIdentity = {
      provider: 'cloudflare',
      zoneId: zone.id,
      zoneName: zone.name,
      accountId: zone.account.id,
      status: zone.status,
    }
    this.assertZoneOwnsHostname(identity, hostname)
    if (identity.status !== 'active') {
      throw new Error(`Cloudflare zone ${identity.zoneName} is not active`)
    }
    return identity
  }

  private assertZoneOwnsHostname(
    zone: DnsZoneIdentity,
    hostname: string
  ): void {
    if (
      hostname !== zone.zoneName &&
      !hostname.endsWith(`.${zone.zoneName}`)
    ) {
      throw new Error(
        `Configured Cloudflare zone ${zone.zoneName} does not own ${hostname}`
      )
    }
  }

  private toRecordIdentity(
    record: z.infer<typeof cloudflareRecordSchema>
  ): DnsRecordIdentity {
    return {
      provider: 'cloudflare',
      zoneId: record.zone_id,
      recordId: record.id,
      type: record.type,
      hostname: record.name,
      content: record.content,
      ttl: record.ttl,
      proxied: record.proxied === true,
    }
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
