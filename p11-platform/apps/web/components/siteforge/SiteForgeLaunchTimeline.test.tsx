import { describe, expect, it } from 'vitest'
import { buildLaunchTimelineItems } from './SiteForgeLaunchTimeline'

describe('SiteForgeLaunchTimeline', () => {
  it('shows DNS propagation before public certification and live state', () => {
    const items = buildLaunchTimelineItems({
      release: {
        id: 'release-1',
        release_version: 4,
        state: 'promoted',
        artifact_id: 'artifact-1',
        artifact_content_hash: 'a'.repeat(64),
        backup_id: 'backup-1',
        promotion_token_consumed_at: '2026-08-10T12:00:00.000Z',
        production_certified_at: null,
        live_at: null,
      },
      events: [
        {
          id: 'event-1',
          to_state: 'promoted',
          rationale: 'Exact promotion verified',
          created_at: '2026-08-10T12:00:00.000Z',
        },
      ],
      dnsSnapshots: [
        {
          id: 'dns-1',
          provider: 'cloudflare',
          domain: 'www.example.com',
          captured_at: '2026-08-10T11:50:00.000Z',
          restored_at: null,
          propagation_report: {
            phase: 'propagation_pending',
            propagation: { propagated: false },
          },
        },
      ],
      restoreDrills: [],
      promotionTokenAvailable: false,
    })

    expect(items.find(item => item.key === 'promoted')?.status).toBe('active')
    expect(items.find(item => item.key === 'dns:dns-1')).toMatchObject({
      status: 'active',
      detail: expect.stringContaining('propagation is pending'),
    })
    expect(items.find(item => item.key === 'live')).toMatchObject({
      status: 'pending',
      detail: 'Requires public production browser certification.',
    })
  })

  it('surfaces supervised recovery after a failed cutover', () => {
    const items = buildLaunchTimelineItems({
      release: {
        id: 'release-1',
        release_version: 4,
        state: 'failed',
        artifact_id: 'artifact-1',
        artifact_content_hash: 'a'.repeat(64),
        backup_id: 'backup-1',
        promotion_token_consumed_at: '2026-08-10T12:00:00.000Z',
        production_certified_at: null,
        live_at: null,
      },
      events: [],
      dnsSnapshots: [],
      restoreDrills: [
        {
          id: 'restore-1',
          status: 'verifying',
          created_at: '2026-08-10T12:10:00.000Z',
          completed_at: null,
        },
      ],
      promotionTokenAvailable: false,
    })

    expect(items.at(-1)).toMatchObject({
      key: 'restore:restore-1',
      status: 'recovery',
    })
  })
})
