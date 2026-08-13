import { describe, expect, it } from 'vitest'
import type { DnsInventory } from '@/utils/siteforge/providers/dns-provider'
import { buildDnsDesiredRecords, resolveDnsHostPolicy } from './dns-cutover'

const inventory: DnsInventory = {
  provider: 'cloudflare',
  zone: {
    provider: 'cloudflare',
    zoneId: 'zone-1',
    zoneName: 'example.com',
    accountId: 'account-1',
    status: 'active',
  },
  hostnames: ['example.com', 'www.example.com'],
  capturedAt: '2026-08-10T12:00:00.000Z',
  records: [
    {
      provider: 'cloudflare',
      zoneId: 'zone-1',
      recordId: 'record-apex',
      type: 'A',
      hostname: 'example.com',
      content: '192.0.2.1',
      ttl: 3600,
      proxied: false,
    },
  ],
}

describe('SiteForge DNS cutover policy', () => {
  it('requires both apex and WWW identities for apex policy', () => {
    expect(resolveDnsHostPolicy('example.com', 'apex')).toEqual({
      canonicalHostname: 'example.com',
      hostnames: ['example.com', 'www.example.com'],
      policy: 'apex',
    })
  })

  it('makes WWW canonical while retaining the apex cutover record', () => {
    expect(resolveDnsHostPolicy('example.com', 'www')).toEqual({
      canonicalHostname: 'www.example.com',
      hostnames: ['example.com', 'www.example.com'],
      policy: 'www',
    })
  })

  it('keeps a custom property subdomain isolated', () => {
    expect(resolveDnsHostPolicy('apartments.example.com', 'custom')).toEqual({
      canonicalHostname: 'apartments.example.com',
      hostnames: ['apartments.example.com'],
      policy: 'custom',
    })
  })

  it('binds existing records by provider ID and declares TTL lowering', () => {
    expect(
      buildDnsDesiredRecords({
        inventory,
        hostnames: inventory.hostnames,
        address: '192.0.2.10',
        ttl: 300,
      })
    ).toEqual([
      {
        hostname: 'example.com',
        address: '192.0.2.10',
        ttl: 300,
        recordId: 'record-apex',
      },
      {
        hostname: 'www.example.com',
        address: '192.0.2.10',
        ttl: 300,
      },
    ])
  })

  it('refuses to overwrite CNAME ownership during cutover', () => {
    expect(() =>
      buildDnsDesiredRecords({
        inventory: {
          ...inventory,
          records: [
            {
              ...inventory.records[0],
              type: 'CNAME',
              content: 'legacy.example.net',
            },
          ],
        },
        hostnames: inventory.hostnames,
        address: '192.0.2.10',
        ttl: 300,
      })
    ).toThrow('conflicts with an existing non-A record')
  })
})
