import { describe, expect, it, vi } from 'vitest'
import { attributionFromUrl, withOutboxAttribution } from './attribution'
import {
  aggregateArtifactFunnels,
  analyticsDestinationSchema,
  evaluateAnomalyRules,
} from './analytics'
import {
  createDurableInventorySnapshot,
  enforceInventoryFreshness,
  enforceInventorySnapshotFreshness,
  InventoryProviderNotConfiguredError,
  RentCafeInventoryAdapter,
  YardiInventoryAdapter,
} from './inventory'
import {
  PermanentOutboxError,
  processSiteForgeOutbox,
  SiteForgeOutboxRegistry,
  type OutboxEvent,
} from './outbox'

describe('SiteForge operations contracts', () => {
  it('normalizes complete attribution and propagates consent into outbox payloads', () => {
    const attribution = attributionFromUrl(
      'https://property.example/?utm_source=google&utm_campaign=summer&gclid=click-1',
      {
        sessionId: 'session-123',
        websiteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        artifactId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        consent: { state: 'granted', capturedAt: '2026-07-31T20:00:00.000Z' },
      }
    )
    expect(attribution).toEqual(expect.objectContaining({
      source: 'google',
      campaign: 'summer',
      clickIds: expect.objectContaining({ gclid: 'click-1' }),
    }))
    expect(withOutboxAttribution({ leadId: 'lead-1' }, attribution)).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          attribution_first_touch: attribution,
          attribution_last_touch: attribution,
        }),
        consentEvidence: attribution.consent,
      })
    )
  })

  it('fails closed for unconfigured providers and retains published inventory until replacement', async () => {
    await expect(new YardiInventoryAdapter().fetch('property-1')).rejects.toBeInstanceOf(
      InventoryProviderNotConfiguredError
    )
    await expect(new RentCafeInventoryAdapter().fetch('property-1')).rejects.toBeInstanceOf(
      InventoryProviderNotConfiguredError
    )
    const result = enforceInventoryFreshness(
      [{
        id: 'a1',
        rentMin: 1800,
        rentMax: 2100,
        availableCount: 2,
        sourceUpdatedAt: '2026-07-29T00:00:00.000Z',
      }],
      {
        propertyId: 'property-1',
        provider: 'yardi',
        maxAgeHours: 24,
        now: new Date('2026-07-31T00:00:00.000Z'),
      }
    )
    expect(result.units[0]).toMatchObject({
      rentMin: 1800,
      rentMax: 2100,
      availableCount: 2,
    })
    expect(result.stale).toBe(false)
    expect(result.revisionProposal).toEqual(expect.objectContaining({
      action: 'keep_published_inventory_until_replaced',
      staleUnitIds: [],
      proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(Object.isFrozen(result.revisionProposal)).toBe(true)
  })

  it('persists hash-addressed snapshots without expiring published pricing', () => {
    const snapshot = createDurableInventorySnapshot({
      propertyId: 'property-1',
      provider: 'yardi',
      sourceWatermark: '2026-07-31T00:00:00.000Z',
      capturedAt: '2026-07-31T00:05:00.000Z',
      freshnessSeconds: 3_600,
      units: [
        {
          id: 'unit-1',
          rent: 1_900,
          rentMin: 1_800,
          rentMax: 2_000,
          monthlyRent: 1_900,
          price: 1_900,
          availableCount: 2,
          availability: 'now',
          specials: 'One month free',
          sourceUpdatedAt: '2026-07-31T00:00:00.000Z',
        },
      ],
    })
    const result = enforceInventorySnapshotFreshness(
      snapshot,
      new Date('2026-07-31T02:00:00.000Z')
    )

    expect(snapshot.snapshotId).toBe(`inventory:property-1:${snapshot.contentHash}`)
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(snapshot.units)).toBe(true)
    expect(result.snapshotStale).toBe(false)
    expect(result.units[0]).toEqual({
      id: 'unit-1',
      rent: 1_900,
      rentMin: 1_800,
      rentMax: 2_000,
      monthlyRent: 1_900,
      price: 1_900,
      availableCount: 2,
      availability: 'now',
      specials: 'One month free',
      sourceUpdatedAt: '2026-07-31T00:00:00.000Z',
    })
  })

  it('does not expire inventory because a source timestamp is malformed', () => {
    const result = enforceInventoryFreshness(
      [{ id: 'bad-time', rentMin: 1_800, sourceUpdatedAt: 'not-a-date' }],
      {
        propertyId: 'property-1',
        provider: 'rentcafe',
        maxAgeHours: 24,
        now: new Date('2026-07-31T00:00:00.000Z'),
      }
    )
    expect(result.units[0]).toHaveProperty('rentMin', 1_800)
    expect(result.stale).toBe(false)
  })

  it('validates destinations and evaluates artifact-aware funnel anomalies', () => {
    expect(analyticsDestinationSchema.safeParse({
      destinationType: 'webhook',
      destinationIdentity: 'http://localhost/hook',
      configuration: { signingSecret: '1234567890123456' },
      consentMode: 'required',
    }).success).toBe(false)
    const [funnel] = aggregateArtifactFunnels([
      { artifact_id: 'artifact-a', event_type: 'page_view', session_id: 's1', lead_id: null },
      { artifact_id: 'artifact-a', event_type: 'page_view', session_id: 's2', lead_id: null },
      { artifact_id: 'artifact-a', event_type: 'lead_submit', session_id: 's1', lead_id: 'l1' },
    ])
    expect(funnel.metrics.leadConversionRate).toBe(0.5)
    expect(evaluateAnomalyRules(funnel, [{
      id: 'lead-rate',
      metric: 'leadConversionRate',
      operator: 'lt',
      threshold: 0.75,
      minimumSessions: 2,
      severity: 'high',
    }])).toHaveLength(1)
  })
})

function outboxClient(event: OutboxEvent) {
  const eventUpdates: Array<Record<string, unknown>> = []
  const attemptUpdates: Array<Record<string, unknown>> = []
  const builder = (table: string) => {
    const chain = {
      eq: vi.fn(),
      lt: vi.fn(),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      insert: vi.fn(() => Promise.resolve({ error: null })),
      update: vi.fn(),
      then: vi.fn(),
    }
    chain.eq.mockImplementation(() => chain)
    chain.lt.mockImplementation(() => chain)
    chain.update.mockImplementation((value) => {
      ;(table === 'siteforge_outbox_events' ? eventUpdates : attemptUpdates).push(value)
      return chain
    })
    chain.then.mockImplementation((resolve: (value: unknown) => unknown) =>
      resolve({ error: null })
    )
    return chain
  }
  return {
    client: {
      from: vi.fn((table: string) => builder(table)),
      rpc: vi.fn().mockResolvedValue({ data: [event], error: null }),
    },
    eventUpdates,
    attemptUpdates,
  }
}

const claimedEvent = {
  id: 'event-1',
  org_id: 'org-1',
  property_id: null,
  website_id: null,
  artifact_id: null,
  aggregate_type: 'lead',
  aggregate_id: 'lead-1',
  event_type: 'test.deliver',
  handler_version: 'v1',
  idempotency_key: 'stable-key',
  payload: {},
  attribution: {},
  consent_evidence: {},
  status: 'processing',
  attempts: 1,
  max_attempts: 2,
  available_at: '2026-07-31T20:00:00.000Z',
  lease_owner: 'worker-1',
  lease_expires_at: '2026-07-31T20:02:00.000Z',
  delivered_at: null,
  last_error: null,
  created_at: '2026-07-31T20:00:00.000Z',
  updated_at: '2026-07-31T20:00:00.000Z',
} satisfies OutboxEvent

describe('leased outbox convergence', () => {
  it('passes a stable idempotency key and marks successful delivery', async () => {
    const fake = outboxClient(claimedEvent)
    const handler = vi.fn().mockResolvedValue({ provider: 'test' })
    const registry = new SiteForgeOutboxRegistry().register('test.deliver', 'v1', handler)
    const result = await processSiteForgeOutbox(fake.client as never, registry, {
      workerId: 'worker-1',
      now: new Date('2026-07-31T20:00:30.000Z'),
    })
    expect(handler).toHaveBeenCalledWith(claimedEvent, {
      idempotencyKey: 'stable-key',
      attempt: 1,
    })
    expect(result.delivered).toBe(1)
    expect(fake.eventUpdates).toContainEqual(expect.objectContaining({ status: 'delivered' }))
  })

  it('retries transient errors and dead-letters permanent errors', async () => {
    const retry = outboxClient(claimedEvent)
    const retryRegistry = new SiteForgeOutboxRegistry().register(
      'test.deliver',
      'v1',
      async () => { throw new Error('temporary') }
    )
    await processSiteForgeOutbox(retry.client as never, retryRegistry, { workerId: 'worker-1' })
    expect(retry.eventUpdates).toContainEqual(expect.objectContaining({ status: 'retrying' }))

    const dead = outboxClient(claimedEvent)
    const deadRegistry = new SiteForgeOutboxRegistry().register(
      'test.deliver',
      'v1',
      async () => { throw new PermanentOutboxError('bad payload') }
    )
    await processSiteForgeOutbox(dead.client as never, deadRegistry, { workerId: 'worker-1' })
    expect(dead.eventUpdates).toContainEqual(expect.objectContaining({ status: 'dead_lettered' }))
  })
})
