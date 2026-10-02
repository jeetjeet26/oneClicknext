/**
 * Deterministic local end-to-end smoke for the ForgeStudio social pipeline:
 *
 *   brief → generate (mock model) → edit → approve → schedule → claim →
 *   publish (provider simulator) → reconcile
 *
 * Runs the real content-store, generation, and publication-worker modules over
 * an in-memory database fake that emulates the queue claim RPC and the
 * uniqueness guarantees (job dedupe key, one live publication per
 * revision+connection).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { AdapterError, type SocialAdapter } from './adapters/types'
import type { TrustedContextBundle } from './context-assembler'
import type { GenerationOutput } from './generation'

// ---------------------------------------------------------------------------
// In-memory database fake
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

const db: Record<string, Row[]> = {}
let idCounter = 0

function genId(): string {
  idCounter += 1
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`
}

function matches(row: Row, filters: Array<{ kind: 'eq' | 'in'; column: string; value: unknown }>) {
  return filters.every((filter) =>
    filter.kind === 'eq'
      ? row[filter.column] === filter.value
      : (filter.value as unknown[]).includes(row[filter.column])
  )
}

const LIVE_PUBLICATION_STATUSES = ['scheduled', 'queued', 'publishing', 'reconciling', 'published']
const LIVE_JOB_STATUSES = ['queued', 'running', 'retrying', 'succeeded']

function checkUnique(table: string, row: Row): { code: string; message: string } | null {
  if (table === 'shared_jobs' && row.dedupe_key) {
    const dupe = (db[table] ?? []).find(
      (existing) =>
        existing.dedupe_key === row.dedupe_key &&
        LIVE_JOB_STATUSES.includes(existing.lifecycle_status as string)
    )
    if (dupe) return { code: '23505', message: 'duplicate key value violates unique constraint' }
  }
  if (table === 'social_publications') {
    const dupe = (db[table] ?? []).find(
      (existing) =>
        existing.revision_id === row.revision_id &&
        existing.connection_id === row.connection_id &&
        LIVE_PUBLICATION_STATUSES.includes(existing.status as string)
    )
    if (dupe) return { code: '23505', message: 'duplicate key value violates unique constraint' }
  }
  return null
}

function createBuilder(table: string) {
  const filters: Array<{ kind: 'eq' | 'in'; column: string; value: unknown }> = []
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let insertPayload: Row[] = []
  let updatePayload: Row = {}
  let wantRows = false
  let orderBy: { column: string; ascending: boolean } | null = null
  let limitCount: number | null = null

  function resolve(): { data: unknown; error: unknown } {
    db[table] = db[table] ?? []

    if (op === 'insert') {
      const inserted: Row[] = []
      for (const raw of insertPayload) {
        const row: Row = {
          id: genId(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...raw,
        }
        const violation = checkUnique(table, row)
        if (violation) return { data: null, error: violation }
        db[table].push(row)
        inserted.push(row)
      }
      return { data: wantRows ? inserted : null, error: null }
    }

    let rows = db[table].filter((row) => matches(row, filters))
    if (orderBy) {
      const { column, ascending } = orderBy
      rows = [...rows].sort((a, b) => {
        const av = a[column] as number
        const bv = b[column] as number
        return ascending ? (av > bv ? 1 : -1) : av > bv ? -1 : 1
      })
    }
    if (limitCount !== null) rows = rows.slice(0, limitCount)

    if (op === 'update') {
      for (const row of rows) Object.assign(row, updatePayload)
      return { data: wantRows ? rows : null, error: null }
    }
    if (op === 'delete') {
      db[table] = db[table].filter((row) => !rows.includes(row))
      return { data: null, error: null }
    }
    return { data: rows, error: null }
  }

  const builder: Record<string, unknown> = {
    insert: (payload: Row | Row[]) => {
      op = 'insert'
      insertPayload = Array.isArray(payload) ? payload : [payload]
      return builder
    },
    update: (payload: Row) => {
      op = 'update'
      updatePayload = payload
      return builder
    },
    delete: () => {
      op = 'delete'
      return builder
    },
    select: () => {
      wantRows = true
      return builder
    },
    eq: (column: string, value: unknown) => {
      filters.push({ kind: 'eq', column, value })
      return builder
    },
    in: (column: string, value: unknown[]) => {
      filters.push({ kind: 'in', column, value })
      return builder
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      orderBy = { column, ascending: options?.ascending ?? true }
      return builder
    },
    limit: (count: number) => {
      limitCount = count
      return builder
    },
    single: async () => {
      const { data, error } = resolve()
      if (error) return { data: null, error }
      const rows = (data ?? []) as Row[]
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { message: `expected 1 row, got ${rows.length}` } }
    },
    maybeSingle: async () => {
      const { data, error } = resolve()
      if (error) return { data: null, error }
      const rows = (data ?? []) as Row[]
      return { data: rows[0] ?? null, error: null }
    },
    then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected),
  }
  return builder
}

function claimSharedJobs(params: {
  p_domain: string
  p_worker: string
  p_limit: number
  p_lease_seconds: number
}) {
  const now = Date.now()
  const due = (db.shared_jobs ?? [])
    .filter(
      (job) =>
        job.domain === params.p_domain &&
        ['queued', 'retrying'].includes(job.lifecycle_status as string) &&
        (!job.available_at || Date.parse(job.available_at as string) <= now)
    )
    .slice(0, params.p_limit)

  for (const job of due) {
    job.lifecycle_status = 'running'
    job.attempt_count = ((job.attempt_count as number) ?? 0) + 1
    job.lease_owner = params.p_worker
    job.lease_expires_at = new Date(now + params.p_lease_seconds * 1000).toISOString()
  }
  return due.map((job) => ({ ...job }))
}

// Editorial transaction result simulator. PostgreSQL atomicity/replay is exercised
// by forgestudio_editorial.test.sql; this fake keeps the worker integration test local.
function editorialResult(fn:string,params:Record<string,unknown>){
 const input=params.p_payload as Row, content=input.content as {conceptSummary:string;variants:Row[];claims:unknown[]}
 const add=(table:string,row:Row)=>{(db[table]??=[]).push(row);return row}
 const scoped={org_id:ORG_ID,property_id:params.p_property_id}
 if(fn==='save_forgestudio_brief'){const brief=add('social_content_briefs',{...scoped,...input,id:params.p_id,status:'draft',created_by:params.p_actor_id});return {state:'saved',brief}}
 if(fn==='save_forgestudio_revision'){
  const pkg=input.packageId?(db.social_content_packages||[]).find(x=>x.id===input.packageId)!:add('social_content_packages',{...scoped,id:genId(),brief_id:input.briefId,status:'in_review'})
  const previous=(db.social_content_revisions||[]).filter(x=>x.package_id===pkg.id);for(const r of previous)r.approval_status='superseded'
  const revision=add('social_content_revisions',{...scoped,id:params.p_id,package_id:pkg.id,revision_number:previous.length+1,content,content_hash:'a'.repeat(64),claims:content.claims,approval_status:'pending',context_snapshot_id:null})
  for(const v of content.variants)add('social_content_variants',{...scoped,...v,id:genId(),revision_id:revision.id,variant_key:v.variantKey,sequence_index:v.sequenceIndex,call_to_action:v.callToAction,link_url:v.linkUrl,asset_ids:v.assetIds,media_urls:v.mediaUrls,content_format:v.contentFormat,platform_options:v.platformOptions,alt_text:v.altText,overlay_text:v.overlayText,safe_area:v.safeArea,subtitle_text:v.subtitleText,thumbnail_asset_id:v.thumbnailAssetId})
  pkg.current_revision_id=revision.id;return{state:'saved',package:pkg,revision}
 }
 const revision=db.social_content_revisions.find(x=>x.id===input.revisionId)!;revision.approval_status=input.decision;revision.approved_by=params.p_actor_id;revision.approval_note=input.note;return{state:'saved',revision}
}
function publicationResult(fn:string,params:Record<string,unknown>):Row{
 const input=(params.p_payload??{}) as Row
 const add=(table:string,row:Row)=>{(db[table]??=[]).push(row);return row}
 if(fn==='schedule_forgestudio_publications'){
  const revision=db.social_content_revisions.find(x=>x.id===input.revisionId)!
  const pkg=db.social_content_packages.find(x=>x.id===revision.package_id)!
  if(revision.approval_status!=='approved'||pkg.current_revision_id!==revision.id)return{state:'stale_revision'}
  const targets=input.destinations as Row[]
  if(targets.some(t=>(db.social_publications??[]).some(p=>p.variant_id===t.variantId&&p.connection_id===t.connectionId)))return{state:'already_scheduled'}
  const publications=targets.map(t=>{const id=genId();const job=add('shared_jobs',{id:genId(),domain:'forgestudio.publication',subject_id:id,lifecycle_status:'queued',attempt_count:0,max_attempts:1,available_at:t.scheduledFor});return add('social_publications',{id,revision_id:revision.id,package_id:pkg.id,property_id:PROPERTY_ID,variant_id:t.variantId,connection_id:t.connectionId,platform:'facebook',status:'scheduled',shared_job_id:job.id})})
  return{state:'saved',publications}
 }
 const publication=db.social_publications.find(x=>x.shared_job_id===params.p_job_id)!
 const job=db.shared_jobs.find(x=>x.id===params.p_job_id)!
 if(fn==='prepare_forgestudio_publication_write'){
  if(params.p_fingerprint){if(publication.status!=='scheduled')return{state:'write_already_recorded'};publication.status='publishing';return{state:'proceed_once',idempotencyKey:'publication:'+publication.id}}
  return{state:'prepared',fingerprint:'fixture-input',publication,variant:db.social_content_variants.find(x=>x.id===publication.variant_id),connection:db.social_connections.find(x=>x.id===publication.connection_id)}
 }
 const success=input.kind==='provider_acknowledged'
 publication.status=success?'published':'reconciling';publication.remote_post_id=input.providerPostId
 job.lifecycle_status=success?'succeeded':'failed'
 if(success)db.social_content_packages.find(x=>x.id===publication.package_id)!.status='published'
 return{state:'saved'}
}
const rpcMock = vi.fn(async (fn: string, params: Record<string, unknown>) => {
  if(['save_forgestudio_brief','save_forgestudio_revision','review_forgestudio_revision'].includes(fn))return{data:editorialResult(fn,params),error:null}
  if(['schedule_forgestudio_publications','prepare_forgestudio_publication_write','finish_forgestudio_publication_write'].includes(fn))return{data:publicationResult(fn,params),error:null}
  if (fn === 'claim_shared_jobs') {
    return { data: claimSharedJobs(params as Parameters<typeof claimSharedJobs>[0]), error: null }
  }
  return { data: null, error: null }
})

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: (table: string) => createBuilder(table), rpc: rpcMock }),
}))

vi.mock('@/utils/forgestudio/crypto', () => ({
  decryptSecret: (value: string) => value.replace(/^enc:/, ''),
  encryptSecret: (value: string) => `enc:${value}`,
}))

// ---------------------------------------------------------------------------
// Provider simulator (stands in for the Facebook adapter)
// ---------------------------------------------------------------------------

const simulator = {
  platform: 'facebook' as const,
  preflight: vi.fn<NonNullable<SocialAdapter['preflight']>>(),
  publish: vi.fn<SocialAdapter['publish']>(),
  reconcile: vi.fn<NonNullable<SocialAdapter['reconcile']>>(),
} satisfies SocialAdapter

vi.mock('@/utils/forgestudio/adapters', async () => {
  const actual = await vi.importActual<typeof import('./adapters/types')>('./adapters/types')
  return {
    ...actual,
    getAdapter: (platform: string) => (platform === 'facebook' ? simulator : null),
    isChannelEnabled: () => true,
    normalizePlatform: (platform: string) => (platform === 'twitter' ? 'x' : platform),
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = genId()
const PROPERTY_ID = genId()
const USER_ID = genId()
const ASSET_ID = genId()

const bundle: TrustedContextBundle = {
  version: 'forgestudio.context.v1',
  propertyId: PROPERTY_ID,
  assembledAt: new Date().toISOString(),
  sources: [
    {
      id: 'structured_inventory:unit-1',
      kind: 'structured_inventory',
      label: 'Approved inventory',
      content: 'One month free on 12-month leases signed in August',
      authority: 'authoritative',
      approvalStatus: 'approved',
      sensitivity: 'sensitive',
      allowedUses: ['claim', 'topic'],
    },
  ],
  assets: [
    {
      id: ASSET_ID,
      name: 'Pool at sunset',
      assetType: 'image',
      fileUrl: 'https://cdn.example.com/pool.jpg',
      thumbnailUrl: null,
      description: 'Resort-style pool at golden hour',
      width: 1080,
      height: 1080,
      durationSeconds: null,
      altText: 'Pool at sunset',
      rightsStatus: 'owned',
      approvalStatus: 'approved',
      curationStatus: 'selected',
    },
  ],
  brandVoice: 'Warm and neighborly',
  targetAudience: null,
  warnings: [],
  policy: {
    legalConfigId: 'legal-1',
    fairHousingRequired: true,
    sensitiveClaimsRequireApproval: true,
  },
  contextHash: 'smoke-hash',
}

const generatedOutput: GenerationOutput = {
  conceptSummary: 'Golden-hour pool moments with the August special.',
  variants: [
    {
      variantKey: 'facebook:image:1',
      sequenceIndex: 0,
      platform: 'facebook',
      caption: 'Summer evenings by the pool. Sign in August, get one month free.',
      hashtags: ['poollife'],
      callToAction: 'Schedule a visit',
      altText: 'Pool at sunset',
      contentFormat: 'image',
      selectedAssetId: ASSET_ID,
      selectedAssetIds: [ASSET_ID],
      storyboard: [],
      overlayText: [],
      safeArea: { topPercent: 10, rightPercent: 8, bottomPercent: 18, leftPercent: 8 },
      subtitleText: null,
      thumbnailAssetId: null,
    },
  ],
  claims: [
    {
      text: 'One month free on 12-month leases signed in August',
      type: 'concession',
      sourceIds: ['structured_inventory:unit-1'],
    },
  ],
}

function makeModel(output: GenerationOutput) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: 100, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 200, text: 200, reasoning: undefined },
      },
      warnings: [],
    },
  })
}

function seedConnection(): string {
  const id = genId()
  db.social_connections = db.social_connections ?? []
  db.social_connections.push({
    id,
    property_id: PROPERTY_ID,
    platform: 'facebook',
    account_id: 'acct-1',
    account_name: 'The Landing',
    is_active: true,
    access_token: 'enc:user-token',
    refresh_token: null,
    token_expires_at: null,
    page_id: 'page-1',
    page_access_token: 'enc:page-token',
    error_count: 0,
  })
  return id
}

beforeEach(() => {
  vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','false')
  for (const key of Object.keys(db)) delete db[key]
  rpcMock.mockClear()
  simulator.preflight.mockReset()
  simulator.publish.mockReset()
  simulator.reconcile.mockReset()
})

// ---------------------------------------------------------------------------
// The smoke
// ---------------------------------------------------------------------------

describe('forgestudio pipeline smoke', () => {
  it('runs brief → generate → edit → approve → schedule → claim → publish', async () => {
    const {
      createBrief,
      createPackageWithRevision,
      addRevision,
      setRevisionApproval,
      schedulePublications,
      ContentStoreError,
    } = await import('./content-store')
    const { generateRevisionContent } = await import('./generation')
    const { processDuePublications } = await import('./publication-worker')

    const connectionId = seedConnection()

    // 1. Brief
    const brief = await createBrief({
      orgId: ORG_ID,
      propertyId: PROPERTY_ID,
      createdBy: USER_ID,
      title: 'August pool campaign',
      objective: 'Drive August tours',
      channels: ['facebook'],
      formatPlan:[{platform:'facebook',contentFormat:'image',quantity:1}],
      connectionIds: [connectionId],
    })
    expect(brief.status).toBe('draft')

    // 2. Generate with the deterministic mock model
    const generation = await generateRevisionContent({
      bundle,
      objective: brief.objective,
      channels: ['facebook'],
      formatPlan: [{ platform: 'facebook', contentFormat: 'image', quantity: 1 }],
      model: makeModel(generatedOutput),
    })
    expect(generation.content.claims[0].citations).toHaveLength(1)

    const { pkg, revision: revision1 } = await createPackageWithRevision({
      orgId: ORG_ID,
      propertyId: PROPERTY_ID,
      briefId: brief.id,
      createdBy: USER_ID,
      content: generation.content,
      author: { kind: 'llm' },
      generationMetadata: generation.metadata as unknown as Record<string, unknown>,
    })

    // 3. Scheduling an unapproved revision is refused.
    await expect(
      schedulePublications({
        requestId:genId(),contentHash:'a'.repeat(64),revisionId: revision1.id,
        destinations: [{ connectionId,variantId:db.social_content_variants.find(x=>x.revision_id===revision1.id)!.id as string,timezone:'UTC',scheduledFor: new Date(Date.now() - 1000).toISOString() }],
        createdBy: USER_ID,
      })
    ).rejects.toThrow(/revision/)

    // 4. Human edit → new immutable revision supersedes revision 1.
    const revision2 = await addRevision(pkg.id, {
      expectedRevisionId:revision1.id,modificationReason:'Improve the opening caption',
      content: {
        ...generation.content,
        variants: [
          {
            ...generation.content.variants[0],
            caption: 'Golden hour + one month free in August. Come see The Landing.',
          },
        ],
      },
      author: { kind: 'user', userId: USER_ID },
    })
    const storedRevision1 = db.social_content_revisions.find((row) => row.id === revision1.id)
    expect(storedRevision1?.approval_status).toBe('superseded')

    // 5. Approve the exact edited revision.
    await setRevisionApproval({contentHash:'a'.repeat(64),note:'Reviewed exact revision', revisionId: revision2.id, decision: 'approved', reviewerId: USER_ID })

    // Superseded revision 1 still cannot be scheduled.
    await expect(
      schedulePublications({
        requestId:genId(),contentHash:'a'.repeat(64),revisionId: revision1.id,
        destinations: [{ connectionId,variantId:db.social_content_variants.find(x=>x.revision_id===revision1.id)!.id as string,timezone:'UTC',scheduledFor: new Date(Date.now() - 1000).toISOString() }],
        createdBy: USER_ID,
      })
    ).rejects.toThrowError(ContentStoreError)

    // 6. Schedule (due immediately so the worker can claim it).
    const [publication] = await schedulePublications({
      requestId:genId(),contentHash:'a'.repeat(64),revisionId: revision2.id,
      destinations: [{ connectionId,variantId:db.social_content_variants.find(x=>x.revision_id===revision2.id)!.id as string,timezone:'UTC',scheduledFor: new Date(Date.now() - 1000).toISOString() }],
      createdBy: USER_ID,
    })
    expect(publication.status).toBe('scheduled')
    expect(publication.shared_job_id).toBeTruthy()

    // 7. Double-scheduling the same revision+connection is refused (dedupe key).
    await expect(
      schedulePublications({
        requestId:genId(),contentHash:'a'.repeat(64),revisionId: revision2.id,
        destinations: [{ connectionId,variantId:db.social_content_variants.find(x=>x.revision_id===revision2.id)!.id as string,timezone:'UTC',scheduledFor: new Date(Date.now() - 1000).toISOString() }],
        createdBy: USER_ID,
      })
    ).rejects.toThrow(/already scheduled/)

    // 8. Worker claims and publishes through the provider simulator.
    simulator.publish.mockResolvedValue({
      providerPostId: 'fb-post-1',
      providerPostUrl: 'https://facebook.com/fb-post-1',
    })
    const run = await processDuePublications({ workerId: 'smoke-worker' })
    expect(run.claimed).toBe(1)
    expect(run.results[0].outcome).toBe('published')
    expect(simulator.publish).toHaveBeenCalledTimes(1)

    const storedPublication = db.social_publications.find((row) => row.id === publication.id)
    expect(storedPublication?.status).toBe('published')
    expect(storedPublication?.remote_post_id).toBe('fb-post-1')

    const storedJob = db.shared_jobs.find((row) => row.id === publication.shared_job_id)
    expect(storedJob?.lifecycle_status).toBe('succeeded')

    const storedPackage = db.social_content_packages.find((row) => row.id === pkg.id)
    expect(storedPackage?.status).toBe('published')

    // 9. Nothing left to claim.
    const secondRun = await processDuePublications({ workerId: 'smoke-worker' })
    expect(secondRun.claimed).toBe(0)
  })

  it('holds an ambiguous timeout-after-send without double posting', async () => {
    const {
      createPackageWithRevision,
      setRevisionApproval,
      schedulePublications,
    } = await import('./content-store')
    const { generateRevisionContent } = await import('./generation')
    const { processDuePublications } = await import('./publication-worker')

    const connectionId = seedConnection()
    const generation = await generateRevisionContent({
      bundle,
      objective: 'Drive tours',
      channels: ['facebook'],
      formatPlan: [{ platform: 'facebook', contentFormat: 'image', quantity: 1 }],
      model: makeModel(generatedOutput),
    })
    const { revision } = await createPackageWithRevision({
      orgId: ORG_ID,
      propertyId: PROPERTY_ID,
      createdBy: USER_ID,
      content: generation.content,
      author: { kind: 'llm' },
    })
    await setRevisionApproval({contentHash:'a'.repeat(64),note:'Reviewed exact revision', revisionId: revision.id, decision: 'approved', reviewerId: USER_ID })
    const [publication] = await schedulePublications({
      requestId:genId(),contentHash:'a'.repeat(64),revisionId: revision.id,
      destinations: [{ connectionId,variantId:db.social_content_variants.find(x=>x.revision_id===revision.id)!.id as string,timezone:'UTC',scheduledFor: new Date(Date.now() - 1000).toISOString() }],
      createdBy: USER_ID,
    })

    // Attempt 1: the provider times out after the post was sent.
    simulator.publish.mockRejectedValueOnce(new AdapterError('timeout after send', 'ambiguous'))
    const firstRun = await processDuePublications({ workerId: 'smoke-worker' })
    expect(firstRun.results[0].outcome).toBe('reconciling')

    let stored = db.social_publications.find((row) => row.id === publication.id)
    expect(stored?.status).toBe('reconciling')

    // Neither fuzzy candidate discovery nor an empty scheduler pass can resend.
    const secondRun=await processDuePublications({workerId:'smoke-worker'})
    expect(secondRun.claimed).toBe(0)
    expect(simulator.reconcile).not.toHaveBeenCalled()
    stored=db.social_publications.find(row=>row.id===publication.id)
    expect(stored?.status).toBe('reconciling')
    // Zero duplicate posts: publish was attempted exactly once.
    expect(simulator.publish).toHaveBeenCalledTimes(1)
  })

  it('never lets two overlapping workers claim the same job', async () => {
    const {
      createPackageWithRevision,
      setRevisionApproval,
      schedulePublications,
    } = await import('./content-store')
    const { generateRevisionContent } = await import('./generation')
    const { processDuePublications } = await import('./publication-worker')

    const connectionId = seedConnection()
    const generation = await generateRevisionContent({
      bundle,
      objective: 'Drive tours',
      channels: ['facebook'],
      formatPlan: [{ platform: 'facebook', contentFormat: 'image', quantity: 1 }],
      model: makeModel(generatedOutput),
    })
    const { revision } = await createPackageWithRevision({
      orgId: ORG_ID,
      propertyId: PROPERTY_ID,
      createdBy: USER_ID,
      content: generation.content,
      author: { kind: 'llm' },
    })
    await setRevisionApproval({contentHash:'a'.repeat(64),note:'Reviewed exact revision', revisionId: revision.id, decision: 'approved', reviewerId: USER_ID })
    await schedulePublications({
      requestId:genId(),contentHash:'a'.repeat(64),revisionId: revision.id,
      destinations: [{ connectionId,variantId:db.social_content_variants.find(x=>x.revision_id===revision.id)!.id as string,timezone:'UTC',scheduledFor: new Date(Date.now() - 1000).toISOString() }],
      createdBy: USER_ID,
    })

    simulator.publish.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { providerPostId: 'fb-once', providerPostUrl: null }
    })

    const [runA, runB] = await Promise.all([
      processDuePublications({ workerId: 'worker-a' }),
      processDuePublications({ workerId: 'worker-b' }),
    ])

    expect(runA.claimed + runB.claimed).toBe(1)
    expect(simulator.publish).toHaveBeenCalledTimes(1)
  })
})
