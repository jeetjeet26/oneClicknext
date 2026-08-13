import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudflareDnsProvider } from './dns-provider'

const zone = {
  success: true,
  errors: [],
  result: {
    id: 'zone-1',
    name: 'example.com',
    status: 'active',
    account: { id: 'account-1' },
  },
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('CloudflareDnsProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads an exact, ownership-verified inventory without mutation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(zone))
      .mockResolvedValueOnce(
        response({
          success: true,
          errors: [],
          result: [
            {
              id: 'record-apex',
              zone_id: 'zone-1',
              type: 'A',
              name: 'example.com',
              content: '192.0.2.1',
              ttl: 3600,
              proxied: false,
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        response({ success: true, errors: [], result: [] })
      )
    vi.stubGlobal('fetch', fetchMock)

    const inventory = await new CloudflareDnsProvider(
      'zone-1',
      'token'
    ).readInventory(['example.com', 'www.example.com'])

    expect(inventory).toMatchObject({
      provider: 'cloudflare',
      zone: {
        zoneId: 'zone-1',
        zoneName: 'example.com',
        accountId: 'account-1',
      },
      records: [
        {
          recordId: 'record-apex',
          hostname: 'example.com',
          content: '192.0.2.1',
        },
      ],
    })
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(
      true
    )
  })

  it('refuses a configured zone that does not own the requested hostname', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(zone)))
    await expect(
      new CloudflareDnsProvider('zone-1', 'token').readInventory([
        'example.net',
      ])
    ).rejects.toThrow('does not own')
  })

  it('reconciles an already-exact A record without a provider write', async () => {
    const record = {
      id: 'record-apex',
      zone_id: 'zone-1',
      type: 'A',
      name: 'example.com',
      content: '192.0.2.10',
      ttl: 300,
      proxied: false,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(zone))
      .mockResolvedValueOnce(
        response({ success: true, errors: [], result: [record] })
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await new CloudflareDnsProvider(
      'zone-1',
      'token'
    ).upsertAddressRecord({
      hostname: 'example.com',
      address: '192.0.2.10',
      ttl: 300,
    })

    expect(result.recordId).toBe('record-apex')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects ambiguous records instead of mutating an arbitrary identity', async () => {
    const records = ['one', 'two'].map(id => ({
      id,
      zone_id: 'zone-1',
      type: 'A',
      name: 'example.com',
      content: '192.0.2.1',
      ttl: 3600,
      proxied: false,
    }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(zone))
      .mockResolvedValueOnce(
        response({ success: true, errors: [], result: records })
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      new CloudflareDnsProvider('zone-1', 'token').upsertAddressRecord({
        hostname: 'example.com',
        address: '192.0.2.10',
      })
    ).rejects.toThrow('multiple A records')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tracks public propagation independently from provider mutation success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        response({
          Status: 0,
          Answer: [{ type: 1, data: '192.0.2.10' }],
        })
      )
    )

    const report = await new CloudflareDnsProvider(
      'zone-1',
      'token'
    ).probePropagation({
      hostnames: ['example.com', 'www.example.com'],
      expectedAddress: '192.0.2.10',
    })

    expect(report.propagated).toBe(true)
    expect(report.observations).toHaveLength(2)
  })
})
