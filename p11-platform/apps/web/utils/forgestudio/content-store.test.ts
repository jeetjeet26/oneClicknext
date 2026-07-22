import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Table-driven Supabase mock.
 *
 * Each table has a FIFO queue of responses. A response is consumed whenever a
 * query chain terminates (.single(), .maybeSingle(), or awaiting the builder).
 * The last response for a table is sticky so repeated fire-and-forget updates
 * do not exhaust the queue. All method calls are recorded in `callLog`.
 */
type QueryResponse = { data: unknown; error: unknown }

const tableResponses: Record<string, QueryResponse[]> = {}
const callLog: Array<{ table: string; method: string; args: unknown[] }> = []

function nextResponse(table: string): QueryResponse {
  const queue = tableResponses[table] ?? []
  if (queue.length === 0) return { data: null, error: null }
  return queue.length > 1 ? queue.shift()! : queue[0]
}

function createBuilder(table: string) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit']) {
    builder[method] = vi.fn((...args: unknown[]) => {
      callLog.push({ table, method, args })
      return builder
    })
  }
  builder.single = vi.fn(async () => nextResponse(table))
  builder.maybeSingle = vi.fn(async () => nextResponse(table))
  builder.then = (
    resolve: (value: QueryResponse) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(nextResponse(table)).then(resolve, reject)
  return builder
}

const fromMock = vi.fn((table: string) => createBuilder(table))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: fromMock }),
}))

function setResponses(table: string, responses: QueryResponse[]) {
  tableResponses[table] = responses
}

function insertsFor(table: string) {
  return callLog.filter((entry) => entry.table === table && entry.method === 'insert')
}

function updatesFor(table: string) {
  return callLog.filter((entry) => entry.table === table && entry.method === 'update')
}

const REVISION_ID = '11111111-1111-4111-8111-111111111111'
const PACKAGE_ID = '22222222-2222-4222-8222-222222222222'
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333'

const validContent = {
  conceptSummary: 'Pool season kickoff',
  variants: [
    {
      platform: 'facebook',
      caption: 'Pool season is here at The Landing.',
    },
  ],
  claims: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(tableResponses)) delete tableResponses[key]
  callLog.length = 0
})

describe('setRevisionApproval', () => {
  it('rejects revisions that are not pending', async () => {
    setResponses('social_content_revisions', [
      { data: { id: REVISION_ID, package_id: PACKAGE_ID, approval_status: 'superseded', claims: [] }, error: null },
    ])
    const { setRevisionApproval, ContentStoreError } = await import('./content-store')
    await expect(
      setRevisionApproval({ revisionId: REVISION_ID, decision: 'approved', reviewerId: 'user-1' })
    ).rejects.toThrowError(ContentStoreError)
  })

  it('fails closed when sensitive claims lack citations', async () => {
    setResponses('social_content_revisions', [
      {
        data: {
          id: REVISION_ID,
          package_id: PACKAGE_ID,
          approval_status: 'pending',
          claims: [{ text: 'Rents from $999', type: 'pricing', citations: [] }],
        },
        error: null,
      },
    ])
    const { setRevisionApproval } = await import('./content-store')
    await expect(
      setRevisionApproval({ revisionId: REVISION_ID, decision: 'approved', reviewerId: 'user-1' })
    ).rejects.toThrow(/lack citations/)
  })

  it('approves a pending revision with supported claims and updates the package', async () => {
    const approvedRow = { id: REVISION_ID, approval_status: 'approved' }
    setResponses('social_content_revisions', [
      {
        data: {
          id: REVISION_ID,
          package_id: PACKAGE_ID,
          approval_status: 'pending',
          claims: [
            {
              text: 'One month free',
              type: 'concession',
              citations: [{ sourceType: 'structured_offer', sourceId: 'offer-1' }],
            },
          ],
        },
        error: null,
      },
      { data: approvedRow, error: null },
    ])
    setResponses('social_content_packages', [{ data: null, error: null }])

    const { setRevisionApproval } = await import('./content-store')
    const result = await setRevisionApproval({
      revisionId: REVISION_ID,
      decision: 'approved',
      reviewerId: 'user-1',
    })

    expect(result).toEqual(approvedRow)
    const packageUpdates = updatesFor('social_content_packages')
    expect(packageUpdates).toHaveLength(1)
    expect(packageUpdates[0].args[0]).toMatchObject({ status: 'approved' })
  })

  it('allows denial without citation checks', async () => {
    const deniedRow = { id: REVISION_ID, approval_status: 'denied' }
    setResponses('social_content_revisions', [
      {
        data: {
          id: REVISION_ID,
          package_id: PACKAGE_ID,
          approval_status: 'pending',
          claims: [{ text: 'Rents from $999', type: 'pricing', citations: [] }],
        },
        error: null,
      },
      { data: deniedRow, error: null },
    ])
    setResponses('social_content_packages', [{ data: null, error: null }])

    const { setRevisionApproval } = await import('./content-store')
    const result = await setRevisionApproval({
      revisionId: REVISION_ID,
      decision: 'denied',
      reviewerId: 'user-1',
      note: 'Pricing is stale',
    })
    expect(result).toEqual(deniedRow)
  })
})

describe('schedulePublications', () => {
  const approvedRevision = {
    id: REVISION_ID,
    package_id: PACKAGE_ID,
    org_id: 'org-1',
    property_id: 'prop-1',
    approval_status: 'approved',
  }

  it('rejects unapproved revisions', async () => {
    setResponses('social_content_revisions', [
      { data: { ...approvedRevision, approval_status: 'pending' }, error: null },
    ])
    const { schedulePublications } = await import('./content-store')
    await expect(
      schedulePublications({
        revisionId: REVISION_ID,
        destinations: [{ connectionId: CONNECTION_ID, scheduledFor: '2026-08-01T17:00:00Z' }],
        createdBy: 'user-1',
      })
    ).rejects.toThrow(/Only approved revisions/)
  })

  it('rejects revisions that are no longer current', async () => {
    setResponses('social_content_revisions', [{ data: approvedRevision, error: null }])
    setResponses('social_content_packages', [
      { data: { current_revision_id: 'some-other-revision' }, error: null },
    ])
    const { schedulePublications } = await import('./content-store')
    await expect(
      schedulePublications({
        revisionId: REVISION_ID,
        destinations: [{ connectionId: CONNECTION_ID, scheduledFor: '2026-08-01T17:00:00Z' }],
        createdBy: 'user-1',
      })
    ).rejects.toThrow(/current revision/)
  })

  it('creates a queued shared job and a publication per destination', async () => {
    const publicationRow = {
      id: 'pub-1',
      revision_id: REVISION_ID,
      connection_id: CONNECTION_ID,
      status: 'scheduled',
    }
    setResponses('social_content_revisions', [{ data: approvedRevision, error: null }])
    setResponses('social_content_packages', [
      { data: { current_revision_id: REVISION_ID }, error: null },
      { data: null, error: null },
    ])
    setResponses('social_content_variants', [
      { data: [{ id: 'variant-1', platform: 'facebook' }], error: null },
    ])
    setResponses('social_connections', [
      {
        data: [{ id: CONNECTION_ID, platform: 'facebook', is_active: true, property_id: 'prop-1' }],
        error: null,
      },
    ])
    setResponses('shared_jobs', [
      { data: { id: 'job-1' }, error: null },
      { data: null, error: null },
    ])
    setResponses('social_publications', [{ data: publicationRow, error: null }])

    const { schedulePublications } = await import('./content-store')
    const result = await schedulePublications({
      revisionId: REVISION_ID,
      destinations: [{ connectionId: CONNECTION_ID, scheduledFor: '2026-08-01T17:00:00Z' }],
      createdBy: 'user-1',
    })

    expect(result).toEqual([publicationRow])

    const jobInserts = insertsFor('shared_jobs')
    expect(jobInserts).toHaveLength(1)
    expect(jobInserts[0].args[0]).toMatchObject({
      domain: 'forgestudio.publication',
      lifecycle_status: 'queued',
      dedupe_key: `publication:${REVISION_ID}:${CONNECTION_ID}`,
    })

    const publicationInserts = insertsFor('social_publications')
    expect(publicationInserts).toHaveLength(1)
    expect(publicationInserts[0].args[0]).toMatchObject({
      revision_id: REVISION_ID,
      connection_id: CONNECTION_ID,
      variant_id: 'variant-1',
      shared_job_id: 'job-1',
      status: 'scheduled',
    })
  })

  it('maps duplicate scheduling to a 409 conflict', async () => {
    setResponses('social_content_revisions', [{ data: approvedRevision, error: null }])
    setResponses('social_content_packages', [
      { data: { current_revision_id: REVISION_ID }, error: null },
    ])
    setResponses('social_content_variants', [
      { data: [{ id: 'variant-1', platform: 'facebook' }], error: null },
    ])
    setResponses('social_connections', [
      {
        data: [{ id: CONNECTION_ID, platform: 'facebook', is_active: true, property_id: 'prop-1' }],
        error: null,
      },
    ])
    setResponses('shared_jobs', [
      { data: null, error: { code: '23505', message: 'duplicate key value' } },
    ])

    const { schedulePublications, ContentStoreError } = await import('./content-store')
    const promise = schedulePublications({
      revisionId: REVISION_ID,
      destinations: [{ connectionId: CONNECTION_ID, scheduledFor: '2026-08-01T17:00:00Z' }],
      createdBy: 'user-1',
    })
    await expect(promise).rejects.toThrowError(ContentStoreError)
    await promise.catch((error) => {
      expect((error as InstanceType<typeof ContentStoreError>).statusCode).toBe(409)
    })
  })

  it('rejects destinations that are inactive or belong to another property', async () => {
    setResponses('social_content_revisions', [{ data: approvedRevision, error: null }])
    setResponses('social_content_packages', [
      { data: { current_revision_id: REVISION_ID }, error: null },
    ])
    setResponses('social_content_variants', [
      { data: [{ id: 'variant-1', platform: 'facebook' }], error: null },
    ])
    setResponses('social_connections', [{ data: [], error: null }])

    const { schedulePublications } = await import('./content-store')
    await expect(
      schedulePublications({
        revisionId: REVISION_ID,
        destinations: [{ connectionId: CONNECTION_ID, scheduledFor: '2026-08-01T17:00:00Z' }],
        createdBy: 'user-1',
      })
    ).rejects.toThrow(/invalid, inactive/)
  })
})

describe('addRevision', () => {
  it('supersedes prior revisions and cancels their scheduled publications', async () => {
    const newRevision = { id: 'rev-3', revision_number: 3 }
    setResponses('social_content_packages', [
      { data: { id: PACKAGE_ID, org_id: 'org-1', property_id: 'prop-1' }, error: null },
      { data: null, error: null },
    ])
    setResponses('social_content_revisions', [
      { data: { revision_number: 2 }, error: null },
      { data: [{ id: 'rev-2' }], error: null },
      { data: newRevision, error: null },
    ])
    setResponses('social_publications', [
      { data: [{ id: 'pub-1', shared_job_id: 'job-1' }], error: null },
    ])
    setResponses('shared_jobs', [{ data: null, error: null }])
    setResponses('social_content_variants', [{ data: null, error: null }])

    const { addRevision } = await import('./content-store')
    const result = await addRevision(PACKAGE_ID, {
      content: validContent as never,
      author: { kind: 'user', userId: 'user-1' },
    })

    expect(result).toEqual(newRevision)

    const revisionInserts = insertsFor('social_content_revisions')
    expect(revisionInserts).toHaveLength(1)
    expect(revisionInserts[0].args[0]).toMatchObject({
      revision_number: 3,
      approval_status: 'pending',
      authored_by_kind: 'user',
      authored_by: 'user-1',
    })

    const supersedeUpdates = updatesFor('social_content_revisions')
    expect(supersedeUpdates).toHaveLength(1)
    expect(supersedeUpdates[0].args[0]).toMatchObject({ approval_status: 'superseded' })

    const publicationUpdates = updatesFor('social_publications')
    expect(publicationUpdates).toHaveLength(1)
    expect(publicationUpdates[0].args[0]).toMatchObject({ status: 'cancelled' })

    const jobUpdates = updatesFor('shared_jobs')
    expect(jobUpdates).toHaveLength(1)
    expect(jobUpdates[0].args[0]).toMatchObject({ lifecycle_status: 'cancelled' })
  })
})

describe('cancelPublication', () => {
  it('cancels a scheduled publication and its queued job', async () => {
    const cancelledRow = { id: 'pub-1', status: 'cancelled', shared_job_id: 'job-1' }
    setResponses('social_publications', [{ data: cancelledRow, error: null }])
    setResponses('shared_jobs', [{ data: null, error: null }])

    const { cancelPublication } = await import('./content-store')
    const result = await cancelPublication('pub-1')
    expect(result).toEqual(cancelledRow)

    const jobUpdates = updatesFor('shared_jobs')
    expect(jobUpdates).toHaveLength(1)
    expect(jobUpdates[0].args[0]).toMatchObject({ lifecycle_status: 'cancelled' })
  })

  it('refuses to cancel a publication that is already publishing', async () => {
    setResponses('social_publications', [
      { data: null, error: { message: 'No rows found', code: 'PGRST116' } },
    ])
    const { cancelPublication } = await import('./content-store')
    await expect(cancelPublication('pub-1')).rejects.toThrow(/cannot be cancelled/)
  })
})
